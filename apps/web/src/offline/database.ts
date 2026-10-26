import { adapters, chargedBytes, type CacheEntry, type CacheModule } from './registry.js';
import { reportStorageIssue, requireMigration } from './status.js';
import { participate, freezeParticipants, resumeParticipants } from './coordinator.js';

export const DATABASE_NAME = 'rodzina-offline';
export const PROTOCOL_KEY = 'offline-protocol:1';
export const ACCOUNT_SIGNAL_KEY = 'offline-account-signal:1';
export const CLEAR_PENDING_KEY = 'offline-clear-pending:1';
const stores = ['cache', 'outbox', 'metadata', 'migration'] as const;
let connection: Promise<IDBDatabase> | undefined;
let epoch = 0;
let context: { accountId: string; generation: string } | undefined;
const transactions = new Set<IDBTransaction>();
const fail = (message: string): never => {
  throw new Error(message);
};
const changed = () => new DOMException('Session changed', 'AbortError');
export const accountToken = () => epoch;
export const isAccountCurrent = (token: number) => token === epoch;

export function invalidateOfflineContext() {
  epoch++;
  context = undefined;
  for (const transaction of transactions) {
    try {
      transaction.abort();
    } catch {
      /* A completed transaction cannot be aborted. */
    }
  }
}
export async function closeDatabase() {
  invalidateOfflineContext();
  const old = connection;
  connection = undefined;
  if (old) (await old.catch(() => undefined))?.close();
}
export function openDatabase(): Promise<IDBDatabase> {
  if (connection) return connection;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE_NAME, 1);
    } catch {
      reject(new Error('Pamięć IndexedDB jest niedostępna. Włącz dostęp do pamięci urządzenia.'));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      const cache = db.createObjectStore('cache', { keyPath: ['accountId', 'module', 'key'] });
      cache.createIndex('accountId', 'accountId');
      cache.createIndex('module', ['accountId', 'module']);
      cache.createIndex('usedAt', ['accountId', 'module', 'usedAt']);
      const outbox = db.createObjectStore('outbox', { keyPath: ['accountId', 'operationId'] });
      outbox.createIndex('accountId', 'accountId');
      outbox.createIndex('sequence', ['accountId', 'sequence'], { unique: true });
      outbox.createIndex('module', ['accountId', 'module']);
      outbox.createIndex('retry', ['accountId', 'status', 'nextAttemptAt']);
      const metadata = db.createObjectStore('metadata', { keyPath: ['accountId', 'key'] });
      metadata.createIndex('accountId', 'accountId');
      const migration = db.createObjectStore('migration', { keyPath: ['accountId', 'module', 'importId'] });
      migration.createIndex('accountId', 'accountId');
      migration.createIndex('module', ['accountId', 'module']);
    };
    let blocked = false;
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Aktualizacja pamięci jest zablokowana. Zamknij pozostałe karty aplikacji i spróbuj ponownie.'));
    };
    request.onerror = () => reject(new Error('Nie można otworzyć pamięci IndexedDB. Włącz pamięć urządzenia.'));
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        db.close();
        return;
      }
      db.onversionchange = () => {
        invalidateOfflineContext();
        db.close();
        connection = undefined;
        reportStorageIssue('Pamięć offline została zaktualizowana w innej karcie. Odśwież aplikację.');
        window.dispatchEvent(new Event('offline-context-invalidated'));
      };
      resolve(db);
    };
  });
  connection = opening;
  void opening.catch(() => {
    if (connection === opening) connection = undefined;
  });
  return opening;
}
export const requestValue = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
export async function transact<T>(
  mode: IDBTransactionMode,
  action: (transaction: IDBTransaction) => Promise<T>,
  token = epoch,
): Promise<T> {
  const db = await openDatabase();
  if (token !== epoch) throw changed();
  const transaction = db.transaction([...stores], mode);
  transactions.add(transaction);
  const completion = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? changed());
  });
  // Register a handler immediately, including when action itself rejects.
  void completion.catch(() => {});
  try {
    const result = await action(transaction);
    await completion;
    if (token !== epoch) throw changed();
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      /* Already completed. */
    }
    await completion.catch(() => {});
    throw error;
  } finally {
    transactions.delete(transaction);
  }
}
type Active = { accountId: '__origin__'; key: 'active'; value: { accountId: string; generation: string } };
export async function assertContext(tx: IDBTransaction, captured = context) {
  const active = await requestValue<Active | undefined>(tx.objectStore('metadata').get(['__origin__', 'active']));
  if (!captured || active?.value.accountId !== captured.accountId || active.value.generation !== captured.generation)
    throw changed();
  return captured;
}
function checkPendingClear() {
  if (localStorage.getItem(CLEAR_PENDING_KEY))
    fail('Usuwanie danych konta nie zostało zakończone. Wyloguj się ponownie lub połącz się z internetem.');
}
export function hasPendingClear() {
  try {
    return !!localStorage.getItem(CLEAR_PENDING_KEY);
  } catch {
    return true;
  }
}
export async function activateOfflineAccount(accountId: string) {
  const token = epoch;
  checkPendingClear();
  await participate(invalidateOfflineContext);
  if (token !== epoch) throw changed();
  const active = await transact(
    'readwrite',
    async (tx) => {
      const store = tx.objectStore('metadata');
      const old = await requestValue<Active | undefined>(store.get(['__origin__', 'active']));
      if (context && old?.value.generation !== context.generation) throw changed();
      if (old && old.value.accountId !== accountId) throw changed();
      const value = old?.value ?? { accountId, generation: crypto.randomUUID() };
      store.put({ accountId: '__origin__', key: 'active', value });
      return value;
    },
    token,
  );
  if (token !== epoch) throw changed();
  context = active;
  return token;
}
export function announceAccount(accountId: string | null) {
  localStorage.setItem(ACCOUNT_SIGNAL_KEY, JSON.stringify({ accountId, nonce: crypto.randomUUID() }));
}
export async function clearDatabase(removeStored = true) {
  invalidateOfflineContext();
  if (!removeStored) return;
  localStorage.setItem(CLEAR_PENDING_KEY, 'yes');
  announceAccount(null);
  await transact('readwrite', async (tx) => {
    for (const name of stores) tx.objectStore(name).clear();
    tx.objectStore('metadata').put({ accountId: '__origin__', key: 'boundary', value: crypto.randomUUID() });
  });
  for (const adapter of adapters.values()) {
    for (const key of Object.keys(localStorage))
      if (key === adapter.legacyKey || key.startsWith(`${adapter.legacyKey}:`)) localStorage.removeItem(key);
  }
  localStorage.removeItem(CLEAR_PENDING_KEY);
  reportStorageIssue();
}
export async function recoverPendingClear() {
  if (localStorage.getItem(CLEAR_PENDING_KEY)) await clearDatabase();
}
export async function readCache(module: CacheModule, accountId?: string) {
  checkPendingClear();
  return transact('readonly', async (tx) => {
    if (accountId) {
      await assertContext(tx);
      if (context?.accountId !== accountId) throw changed();
      return requestValue<CacheEntry | undefined>(tx.objectStore('cache').get([accountId, module, 'snapshot']));
    }
    const active = await requestValue<Active | undefined>(tx.objectStore('metadata').get(['__origin__', 'active']));
    if (!active) return;
    return requestValue<CacheEntry | undefined>(
      tx.objectStore('cache').get([active.value.accountId, module, 'snapshot']),
    );
  });
}
export function makeEntry(module: CacheModule, input: unknown): CacheEntry {
  const adapter = adapters.get(module)!;
  const entry = (payload: unknown): CacheEntry => {
    const value = adapter.parseCache(payload) as { account: string; syncedAt?: number };
    const key = [value.account, module, 'snapshot'];
    const record = {
      accountId: value.account,
      module,
      key: 'snapshot',
      schemaVersion: 1 as const,
      payload,
      ...adapter.describe(payload),
      usedAt: Date.now(),
    };
    let size = chargedBytes(key, { ...record, chargedBytes: 0 });
    while (size !== chargedBytes(key, { ...record, chargedBytes: size }))
      size = chargedBytes(key, { ...record, chargedBytes: size });
    return { ...record, chargedBytes: size };
  };
  const trimmed = adapter.trim(input, (payload) => entry(payload).chargedBytes <= adapter.budget);
  const result = entry(trimmed);
  if (result.chargedBytes > adapter.budget)
    fail('Nie można zapisać danych offline: przekroczono budżet pamięci modułu.');
  return result;
}
function putEntry(tx: IDBTransaction, entry: CacheEntry) {
  tx.objectStore('cache').put(entry);
  tx.objectStore('metadata').put({ accountId: entry.accountId, key: `engine:${entry.module}`, value: 'legacy-idb' });
  tx.objectStore('metadata').put({
    accountId: entry.accountId,
    key: `budget:${entry.module}`,
    value: entry.chargedBytes,
  });
}
export async function writeCache(module: CacheModule, value: unknown, token = epoch) {
  checkPendingClear();
  if (token !== epoch) throw changed();
  await ensureMigrated();
  const captured = context;
  const entry = makeEntry(module, value);
  await transact(
    'readwrite',
    async (tx) => {
      const active = await assertContext(tx, captured);
      if (entry.accountId !== active.accountId) throw changed();
      putEntry(tx, entry);
    },
    token,
  );
  return entry.payload;
}

type ImportState = {
  accountId: string;
  module: 'preview';
  importId: 'v1';
  phase: 'staged' | 'committed' | 'verified';
  source: Record<string, string>;
  entries: CacheEntry[];
  sourceDigest: string;
  targetDigest: string;
  boundary: string | undefined;
};
async function readBoundary(tx: IDBTransaction): Promise<string | undefined> {
  const record = await requestValue<{ value: string } | undefined>(
    tx.objectStore('metadata').get(['__origin__', 'boundary']),
  );
  return record?.value;
}
async function assertImportBoundary(tx: IDBTransaction, state: ImportState) {
  if ((await readBoundary(tx)) !== state.boundary) throw changed();
}
const digest = async (value: unknown) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
const sourceEntries = () =>
  Object.fromEntries(
    [...adapters.values()]
      .filter((adapter) => !adapter.separateMigration)
      .flatMap((adapter) => {
        const raw = localStorage.getItem(adapter.legacyKey);
        return raw === null ? [] : [[adapter.legacyKey, raw]];
      }),
  );
function sameSource(state: ImportState, allowRemoved: boolean) {
  if (Object.keys(sourceEntries()).some((key) => !(key in state.source)))
    fail('Pojawiły się nowe dane starej karty. Zamknij starsze karty i ponów aktualizację.');
  for (const [key, raw] of Object.entries(state.source)) {
    const now = localStorage.getItem(key);
    if (now !== raw && !(allowRemoved && now === null))
      fail('Dane starej karty zmieniły się podczas importu. Zamknij starsze karty i ponów aktualizację.');
  }
}
const migrations = new Map<string, (confirmed: boolean) => Promise<void>>();
export function registerMigration(name: string, migrate: (confirmed: boolean) => Promise<void>) {
  migrations.set(name, migrate);
}
export async function ensureMigrated(confirmed = false) {
  await migratePreviews(confirmed);
  for (const migrate of migrations.values()) await migrate(confirmed);
}
async function migratePreviews(confirmed = false) {
  checkPendingClear();
  const token = epoch;
  // Web Locks serializes new clients. Pre-protocol clients require the explicit maintenance procedure.
  const work = async () => {
    const boundary = await transact('readonly', readBoundary, token);
    const states = await transact(
      'readonly',
      async (tx) => requestValue<ImportState[]>(tx.objectStore('migration').getAll()),
      token,
    );
    let state = states.find((state) => state.module === 'preview');
    const source = sourceEntries();
    if (!state && !Object.keys(source).length) {
      requireMigration(false);
      return;
    }
    if (!confirmed && localStorage.getItem(PROTOCOL_KEY) !== 'migrating') {
      requireMigration(true);
      fail('Dane offline wymagają przeniesienia. Zamknij starsze karty aplikacji i potwierdź aktualizację pamięci.');
    }
    if (!navigator.locks?.query)
      fail(
        'Ta przeglądarka nie obsługuje bezpiecznej aktualizacji pamięci. Użyj aktualnej przeglądarki lub aplikacji Android.',
      );
    if (!state && localStorage.getItem(PROTOCOL_KEY) === 'active')
      fail('Starsza karta ponownie zapisała dane po aktualizacji. Zamknij ją i wyloguj się przed dalszą pracą.');
    localStorage.setItem(PROTOCOL_KEY, 'migrating');
    await freezeParticipants();
    if (!state) {
      const entries = [...adapters.values()]
        .filter((adapter) => !adapter.separateMigration)
        .flatMap((adapter) => {
          const raw = source[adapter.legacyKey];
          return raw === undefined ? [] : [makeEntry(adapter.module, adapter.parseCache(JSON.parse(raw)))];
        });
      const accounts = new Set(entries.map((entry) => entry.accountId));
      if (accounts.size !== 1)
        fail('Nie można połączyć danych offline różnych kont. Wyloguj się i pobierz dane ponownie.');
      const accountId = entries[0]!.accountId;
      const shopping = localStorage.getItem('rodzina:shopping:v1');
      if (shopping) {
        const saved = JSON.parse(shopping);
        if (saved.buster && saved.buster !== accountId)
          fail('Dane offline należą do różnych kont. Wyloguj się i pobierz je ponownie.');
      }
      state = {
        accountId,
        module: 'preview',
        importId: 'v1',
        phase: 'staged',
        source,
        entries,
        sourceDigest: await digest(source),
        targetDigest: await digest(entries),
        boundary,
      };
      if (chargedBytes(accountId, state) > 48 * 1048576)
        fail('Brak miejsca na kopię danych podczas aktualizacji pamięci.');
      const estimate = await navigator.storage?.estimate?.();
      const needed =
        2 *
          (new TextEncoder().encode(JSON.stringify(source)).byteLength +
            new TextEncoder().encode(JSON.stringify(entries)).byteLength) +
        1048576;
      if (estimate?.quota !== undefined && estimate.usage !== undefined && estimate.quota - estimate.usage < needed)
        fail('Brak miejsca na bezpieczne przeniesienie danych offline. Zwolnij miejsce i ponów próbę.');
      sameSource(state, false);
      const captured = state;
      await transact(
        'readwrite',
        async (tx) => {
          await assertImportBoundary(tx, captured);
          tx.objectStore('migration').put(captured);
        },
        token,
      );
    }
    if ((await digest(state.source)) !== state.sourceDigest || (await digest(state.entries)) !== state.targetDigest)
      fail('Kopia robocza importu jest uszkodzona. Źródło zostało zachowane.');
    if (state.phase === 'staged') {
      sameSource(state, false);
      const captured = state;
      const accountId = state.accountId;
      await transact(
        'readwrite',
        async (tx) => {
          await assertImportBoundary(tx, captured);
          const old = await requestValue<Active | undefined>(tx.objectStore('metadata').get(['__origin__', 'active']));
          if (old && old.value.accountId !== accountId) throw changed();
          for (const entry of captured.entries) putEntry(tx, entry);
          tx.objectStore('migration').put({ ...captured, phase: 'committed' });
          tx.objectStore('metadata').put({
            accountId: '__origin__',
            key: 'active',
            value: old?.value ?? { accountId, generation: crypto.randomUUID() },
          });
        },
        token,
      );
      state = { ...captured, phase: 'committed' };
    }
    const captured = state;
    if (state.phase === 'committed') {
      sameSource(state, false);
      await transact(
        'readwrite',
        async (tx) => {
          await assertImportBoundary(tx, captured);
          for (const expected of captured.entries) {
            const actual = await requestValue<CacheEntry | undefined>(
              tx.objectStore('cache').get([expected.accountId, expected.module, expected.key]),
            );
            if (JSON.stringify(actual) !== JSON.stringify(expected))
              fail('Weryfikacja przeniesionych danych nie powiodła się. Źródło zostało zachowane.');
          }
          tx.objectStore('migration').put({ ...captured, phase: 'verified' });
        },
        token,
      );
    }
    if (token !== epoch) throw changed();
    sameSource(state, true);
    for (const key of Object.keys(state.source)) localStorage.removeItem(key);
    if (Object.keys(state.source).some((key) => localStorage.getItem(key) !== null))
      fail('Nie można usunąć starej kopii danych offline.');
    await transact(
      'readwrite',
      async (tx) => {
        await assertImportBoundary(tx, captured);
        tx.objectStore('migration').delete([captured.accountId, 'preview', 'v1']);
        for (const entry of captured.entries)
          tx.objectStore('metadata').put({
            accountId: entry.accountId,
            key: `engine:${entry.module}`,
            value: 'legacy-idb',
          });
        tx.objectStore('metadata').put({ accountId: captured.accountId, key: 'import:preview:v1', value: 'active' });
      },
      token,
    );
    localStorage.setItem(PROTOCOL_KEY, 'active');
    requireMigration(false);
    reportStorageIssue();
    resumeParticipants();
  };
  if (navigator.locks) await navigator.locks.request(PROTOCOL_KEY, work);
  else await work();
}

window.addEventListener('storage', (event) => {
  if (event.key === ACCOUNT_SIGNAL_KEY) {
    invalidateOfflineContext();
    window.dispatchEvent(new Event('offline-account-changed'));
  }
});
