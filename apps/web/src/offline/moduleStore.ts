import { useEffect, useSyncExternalStore } from 'react';
import { registerAccountStore } from '../accountStorage.js';
import {
  accountToken,
  assertContext,
  activateOfflineAccount,
  isAccountCurrent,
  readAccountCache,
  transact,
  writeCache,
} from './database.js';
import { registerAdapter, type CacheModule, type OfflineAdapter } from './registry.js';
import { offlineTransaction, withOfflineAccount, type OfflineTransaction } from './transaction.js';
import { watchOutbox } from './signals.js';
import { storageError } from './status.js';
import { joinSync, type SyncAdapter } from './sync.js';

type AccountSnapshot = { account: string };
type CacheAdapter<Snapshot> = Omit<OfflineAdapter, 'parseCache' | 'capabilities'> & {
  parseCache: (value: unknown) => Snapshot;
};

export type OfflineModule<Snapshot extends AccountSnapshot, Change, View, Context = undefined> = {
  cache: CacheAdapter<Snapshot>;
  readError: (detail: string) => string;
} & (
  | {
      mode: 'read-only';
      project: (snapshot: Snapshot) => View;
      writeError: (detail: string) => string;
    }
  | {
      mode: 'read-write';
      prepareRead?: (tx: OfflineTransaction, account: string) => Promise<void>;
      // Read in the same transaction as the snapshot, in projection order.
      readChanges: (tx: OfflineTransaction, snapshot: Snapshot | undefined) => Promise<readonly Change[]>;
      project: (snapshot: Snapshot | undefined, changes: readonly Change[]) => View;
      sync: (account: string, context?: Context) => Omit<SyncAdapter, 'module'>;
      deferSync?: boolean;
    }
);

type State<Snapshot, View> = { account: string; saved?: Snapshot; view?: View; issue?: string };
type ExternalStore<State> = {
  activate: (account: string) => Promise<void>;
  snapshot: () => State;
  subscribe: (listener: () => void) => () => void;
};

export const cacheSignal = (module: CacheModule) => `offline-${module}-changed:1`;

export function registerOfflineModule<Snapshot extends AccountSnapshot, Change, View, Context = undefined>(
  definition: OfflineModule<Snapshot, Change, View, Context>,
) {
  registerAdapter({ ...definition.cache, capabilities: definition.mode });
  return {
    withAccount: withOfflineAccount,
    createStore: (context?: Context) => createOfflineStore(definition, context),
    registerStore: (
      store: { clear: () => void } & (
        | { activate: (account: string) => Promise<void> }
        | { restore: NonNullable<Parameters<typeof registerAccountStore>[0]['restore']> }
      ),
    ) =>
      registerAccountStore({
        name: definition.cache.module,
        phase: 'before-invalidation',
        // Some stores need the session and query client before activating.
        ...('restore' in store ? { restore: store.restore } : { activate: store.activate }),
        clear: store.clear,
        stop: store.clear,
      }),
  };
}

function createOfflineStore<Snapshot extends AccountSnapshot, Change, View, Context>(
  definition: OfflineModule<Snapshot, Change, View, Context>,
  context?: Context,
) {
  const { module, parseCache, schemaVersion } = definition.cache;
  const signal = cacheSignal(module);
  let state: State<Snapshot, View> = { account: '' };
  let revision = 0;
  let request = 0;
  let ready = Promise.resolve();
  let updates = Promise.resolve();
  let sender: ReturnType<typeof joinSync> | undefined;
  let stopWatching: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const current = (captured: number) => captured === revision && scope.current();

  // Reloads supersede reads, but only account changes invalidate module transactions.
  function createScope(account: string, token: number) {
    const captured = {
      account,
      token,
      current: () => !!account && scope === captured && isAccountCurrent(token),
    };
    return captured;
  }
  let scope = createScope('', accountToken());

  function emit(next: State<Snapshot, View>) {
    state = next;
    listeners.forEach((listener) => listener());
  }

  async function whenReady() {
    let pending: Promise<void>;
    do {
      pending = ready;
      await pending;
    } while (pending !== ready);
  }

  function startSender() {
    if (definition.mode !== 'read-write' || !scope.current()) return;
    if (!sender?.isActive()) {
      sender?.stop();
      const changed = () => load();
      sender = joinSync(
        state.account,
        {
          ...(context === undefined ? definition.sync(state.account) : definition.sync(state.account, context)),
          module,
        },
        changed,
      );
    }
    return sender;
  }

  function stop() {
    stopWatching?.();
    stopWatching = undefined;
    sender?.stop();
    sender = undefined;
  }

  function load(prepare = false) {
    const activeScope = scope;
    if (!activeScope.current()) return ready;
    const { account } = activeScope;
    const captured = ++revision;
    const current = () => captured === revision && activeScope.current();
    ready = (async () => {
      try {
        const prepareRead = definition.mode === 'read-write' && prepare ? definition.prepareRead : undefined;
        if (!stopWatching) {
          await activateOfflineAccount(account);
          if (!current()) return;
        }
        const next = await transact(
          prepareRead ? 'readwrite' : 'readonly',
          async (tx) => {
            if (prepareRead) {
              if (!activeScope.current()) throw new DOMException('Session changed', 'AbortError');
              assertContext(tx, account);
              await prepareRead(offlineTransaction(tx, account), account);
            }
            const record = await readAccountCache(tx, module, account);
            const saved = record && parseCache(record.payload);
            if (record && (record.schemaVersion !== schemaVersion || saved?.account !== account))
              throw new Error('Nieprawidłowa wersja lub konto danych offline.');
            if (definition.mode === 'read-write') {
              const changes = await definition.readChanges(offlineTransaction(tx, account), saved);
              return { account, ...(saved ? { saved } : {}), view: definition.project(saved, changes) };
            }
            return saved ? { account, saved, view: definition.project(saved) } : { account };
          },
          activeScope.token,
        );
        if (!current()) return;
        if (definition.mode === 'read-write' && !stopWatching) {
          const unwatch = watchOutbox(account, () => void load());
          window.addEventListener('storage', onStorage);
          window.addEventListener('offline-context-invalidated', stop);
          stopWatching = () => {
            unwatch();
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('offline-context-invalidated', stop);
          };
          if (!definition.deferSync) startSender();
        }
        emit(next);
      } catch (cause) {
        if (current()) emit({ ...state, issue: definition.readError(storageError(cause)) });
      }
    })();
    return ready;
  }

  function onStorage(event: StorageEvent) {
    if (event.key === signal || event.key === null) void load(true);
  }

  async function persistSnapshot(
    saved: Snapshot,
    mode: Extract<typeof definition, { mode: 'read-only' }>,
    assertCurrent: () => void,
    keepAbortedPreview = true,
  ) {
    let durable: unknown;
    try {
      durable = await writeCache(module, saved, scope.token, assertCurrent);
    } catch (cause) {
      assertCurrent();
      const issue = mode.writeError(storageError(cause));
      const aborted = cause instanceof DOMException && cause.name === 'AbortError';
      emit(
        aborted && !keepAbortedPreview
          ? { ...state, issue }
          : { account: saved.account, saved, view: mode.project(saved), issue },
      );
      return false;
    }
    assertCurrent();
    const stored = durable === saved ? saved : parseCache(durable);
    emit({ account: saved.account, saved: stored, view: mode.project(stored) });
    return true;
  }

  return {
    snapshot: () => state,
    accountScope: () => scope,
    whenReady,
    notify: () => emit({ ...state }),
    publishCommitted(captured: typeof scope, saved: Snapshot, changes: readonly Change[]) {
      if (definition.mode !== 'read-write' || !captured.current() || saved.account !== captured.account)
        throw new DOMException('Session changed', 'AbortError');
      revision++;
      emit({ account: saved.account, saved, view: definition.project(saved, changes) });
    },
    token: () => revision,
    current,
    subscribe(listener: () => void) {
      if (definition.mode === 'read-only' && !listeners.size) window.addEventListener('storage', onStorage);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (definition.mode === 'read-only' && !listeners.size) window.removeEventListener('storage', onStorage);
      };
    },
    activate(account: string) {
      if (scope.account === account && scope.current()) return whenReady();
      stop();
      revision++;
      scope = createScope(account, accountToken());
      emit({ account });
      void load(true);
      return whenReady();
    },
    clear() {
      revision++;
      stop();
      scope = createScope('', accountToken());
      ready = Promise.resolve();
      emit({ account: '' });
    },
    reload() {
      void load(true);
      return whenReady();
    },
    synchronize: () => startSender()?.synchronize(),
    // Merge independently fetched parts in order. Existing caches can keep their signaling protocol.
    updateSnapshot(captured: number, update: (account: string, saved: Snapshot | undefined) => Snapshot) {
      if (definition.mode !== 'read-only') throw new Error('Use the module transaction to refresh a writable cache');
      const mode = definition;
      const work = updates.then(async () => {
        await ready;
        if (!current(captured)) return;
        const assertCurrent = () => {
          if (!current(captured)) throw new DOMException('Session changed', 'AbortError');
        };
        try {
          const saved = parseCache(update(state.account, state.saved));
          if (saved.account !== state.account) throw new DOMException('Session changed', 'AbortError');
          await persistSnapshot(saved, mode, assertCurrent, false);
        } catch (cause) {
          if (current(captured)) emit({ ...state, issue: mode.writeError(storageError(cause)) });
        }
      });
      updates = work;
      return work;
    },
    async fetchSnapshot<Raw>(account: string, load: () => Promise<Raw>, toSnapshot: (raw: Raw) => unknown) {
      if (definition.mode !== 'read-only') throw new Error('Use the module transaction to refresh a writable cache');
      const captured = revision;
      const activeScope = scope;
      const sequence = ++request;
      const assertCurrent = () => {
        if (!activeScope.current() || activeScope.account !== account || captured !== revision || sequence !== request)
          throw new DOMException('Session changed', 'AbortError');
      };
      const raw = await load();
      await ready;
      assertCurrent();
      const saved = parseCache(toSnapshot(raw));
      if (saved.account !== account) throw new DOMException('Session changed', 'AbortError');
      if (await persistSnapshot(saved, definition, assertCurrent)) {
        assertCurrent();
        try {
          localStorage.setItem(signal, crypto.randomUUID());
        } catch {
          // IDB remains authoritative.
        }
      }
      return saved;
    },
  };
}

export function useOfflineModule<Snapshot, View>(
  store: ExternalStore<State<Snapshot, View>>,
  account: string,
): State<Snapshot, View> {
  const state = useSyncExternalStore(store.subscribe, store.snapshot);
  useEffect(() => {
    if (account) void store.activate(account);
  }, [store, account]);
  return state.account === account ? state : { account };
}
