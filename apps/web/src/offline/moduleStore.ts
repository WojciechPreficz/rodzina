import { useEffect, useSyncExternalStore } from 'react';
import { registerAccountStore } from '../accountStorage.js';
import {
  accountToken,
  activateOfflineAccount,
  ensureMigrated,
  isAccountCurrent,
  readAccountCache,
  transact,
  writeCache,
} from './database.js';
import { registerAdapter, type CacheModule, type OfflineAdapter } from './registry.js';
import { watchOutbox } from './signals.js';
import { storageError } from './status.js';
import { joinSync, type SyncAdapter } from './sync.js';

type AccountSnapshot = { account: string };
type CacheAdapter<Snapshot> = Omit<OfflineAdapter, 'parseCache' | 'capabilities'> & {
  parseCache: (value: unknown) => Snapshot;
};

export type OfflineModule<Snapshot extends AccountSnapshot, Change, View> = {
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
      // Read in the same transaction as the snapshot, in projection order.
      readChanges: (tx: IDBTransaction, account: string, snapshot: Snapshot | undefined) => Promise<readonly Change[]>;
      project: (snapshot: Snapshot | undefined, changes: readonly Change[]) => View;
      sync: (account: string) => Omit<SyncAdapter, 'module'>;
    }
);

type State<Snapshot, View> = { account: string; saved?: Snapshot; view?: View; issue?: string };
type ExternalStore<State> = {
  activate: (account: string) => Promise<void>;
  snapshot: () => State;
  subscribe: (listener: () => void) => () => void;
};

export const cacheSignal = (module: CacheModule) => `offline-${module}-changed:1`;

export function registerOfflineModule<Snapshot extends AccountSnapshot, Change, View>(
  definition: OfflineModule<Snapshot, Change, View>,
) {
  registerAdapter({ ...definition.cache, capabilities: definition.mode });
  return {
    createStore: () => createOfflineStore(definition),
    registerStore: (store: ExternalStore<State<Snapshot, View>> & { clear: () => void }) =>
      registerAccountStore({
        name: definition.cache.module,
        phase: 'before-invalidation',
        activate: store.activate,
        clear: store.clear,
        stop: store.clear,
      }),
  };
}

function createOfflineStore<Snapshot extends AccountSnapshot, Change, View>(
  definition: OfflineModule<Snapshot, Change, View>,
) {
  const { module, parseCache, schemaVersion } = definition.cache;
  const signal = cacheSignal(module);
  let state: State<Snapshot, View> = { account: '' };
  let revision = 0;
  let request = 0;
  let token = accountToken();
  let ready = Promise.resolve();
  let updates = Promise.resolve();
  let stopSync: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const current = (captured: number) => captured === revision && !!state.account && isAccountCurrent(token);

  function emit(next: State<Snapshot, View>) {
    state = next;
    listeners.forEach((listener) => listener());
  }

  function reload() {
    const account = state.account;
    if (!account || !isAccountCurrent(token)) return ready;
    const captured = ++revision;
    const current = () => captured === revision && isAccountCurrent(token);
    ready = (async () => {
      try {
        await ensureMigrated();
        if (!current()) return;
        await activateOfflineAccount(account);
        if (!current()) return;
        const next = await transact(
          'readonly',
          async (tx) => {
            const record = await readAccountCache(tx, module, account);
            const saved = record && parseCache(record.payload);
            if (record && (record.schemaVersion !== schemaVersion || saved?.account !== account))
              throw new Error('Nieprawidłowa wersja lub konto danych offline.');
            if (definition.mode === 'read-write') {
              const changes = await definition.readChanges(tx, account, saved);
              return { account, ...(saved ? { saved } : {}), view: definition.project(saved, changes) };
            }
            return saved ? { account, saved, view: definition.project(saved) } : { account };
          },
          token,
        );
        if (!current()) return;
        if (definition.mode === 'read-write' && !stopSync) {
          const sender = joinSync(account, { ...definition.sync(account), module }, reload);
          const unwatch = watchOutbox(account, () => void reload());
          stopSync = () => {
            unwatch();
            sender.stop();
          };
        }
        emit(next);
      } catch (cause) {
        if (current()) emit({ ...state, issue: definition.readError(storageError(cause)) });
      }
    })();
    return ready;
  }

  function onStorage(event: StorageEvent) {
    if (event.key === signal || event.key === null) void reload();
  }

  async function persistSnapshot(
    saved: Snapshot,
    mode: Extract<typeof definition, { mode: 'read-only' }>,
    assertCurrent: () => void,
    keepAbortedPreview = true,
  ) {
    let durable: unknown;
    try {
      durable = await writeCache(module, saved, token, assertCurrent);
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
    token: () => revision,
    current,
    subscribe(listener: () => void) {
      if (!listeners.size) window.addEventListener('storage', onStorage);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) window.removeEventListener('storage', onStorage);
      };
    },
    activate(account: string) {
      if (state.account === account && isAccountCurrent(token)) return ready;
      stopSync?.();
      stopSync = undefined;
      revision++;
      token = accountToken();
      emit({ account });
      return reload();
    },
    clear() {
      revision++;
      stopSync?.();
      stopSync = undefined;
      ready = Promise.resolve();
      emit({ account: '' });
    },
    reload,
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
      const capturedToken = token;
      const sequence = ++request;
      const assertCurrent = () => {
        if (
          captured !== revision ||
          !isAccountCurrent(capturedToken) ||
          sequence !== request ||
          state.account !== account ||
          !account
        )
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
