import { adapters, chargedBytes, type CacheEntry, type CacheModule } from './registry.js';
import { reportStorageIssue } from './status.js';
import { participate } from './coordinator.js';

export const DATABASE_NAME = 'rodzina-offline';
export const PROTOCOL_KEY = 'offline-protocol:1';
export const ACCOUNT_SIGNAL_KEY = 'offline-account-signal:1';
export const CLEAR_PENDING_KEY = 'offline-clear-pending:1';
const stores = ['cache', 'outbox', 'metadata', 'migration'] as const;
let connection: Promise<IDBDatabase> | undefined;
let epoch = 0;
let context: { accountId: string; generation: string } | undefined;
let clearing: Promise<void> | undefined;
const transactions = new Set<IDBTransaction>();
const fail = (message: string): never => {
  throw new Error(message);
};
export const changed = () => new DOMException('Session changed', 'AbortError');
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
      request = indexedDB.open(DATABASE_NAME, 3);
    } catch {
      reject(new Error('Pamięć IndexedDB jest niedostępna. Włącz dostęp do pamięci urządzenia.'));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      // Version 3 fences the O.4 task sender as well as the O.3 shopping sender.
      // Older IDB clients close on versionchange and cannot reopen their version.
      if (db.objectStoreNames.contains('cache')) return;
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
  try {
    const result = await runTransaction(transaction, action);
    if (token !== epoch) throw changed();
    return result;
  } finally {
    transactions.delete(transaction);
  }
}
async function runTransaction<T>(transaction: IDBTransaction, action: (transaction: IDBTransaction) => Promise<T>) {
  const completion = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? changed());
  });
  // Register a handler immediately, including when action itself rejects.
  void completion.catch(() => {});
  try {
    const result = await action(transaction);
    await completion;
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      /* Already completed. */
    }
    await completion.catch(() => {});
    throw error;
  }
}
export type Active = { accountId: '__origin__'; key: 'active'; value: { accountId: string; generation: string } };
export async function assertContext(tx: IDBTransaction, captured = context) {
  const active = await requestValue<Active | undefined>(tx.objectStore('metadata').get(['__origin__', 'active']));
  if (!captured || active?.value.accountId !== captured.accountId || active.value.generation !== captured.generation)
    throw changed();
  return captured;
}
export function checkPendingClear() {
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
export async function activateOfflineAccount(accountId: string, confirmed = false) {
  const token = epoch;
  checkPendingClear();
  await participate(invalidateOfflineContext);
  if (token !== epoch) throw changed();
  const active = await transact(
    'readwrite',
    async (tx) => {
      checkPendingClear();
      const store = tx.objectStore('metadata');
      const old = await requestValue<Active | undefined>(store.get(['__origin__', 'active']));
      if (context && old?.value.generation !== context.generation) throw changed();
      if (old && old.value.accountId !== accountId) throw changed();
      const suspended = await requestValue<{ value: string } | undefined>(store.get(['__origin__', 'suspended']));
      if (suspended) {
        if (!confirmed) throw changed();
        if (suspended.value !== accountId) {
          tx.objectStore('outbox').clear();
          tx.objectStore('cache').clear();
          for (const key of await requestValue(store.index('accountId').getAllKeys(suspended.value))) store.delete(key);
        }
        store.delete(['__origin__', 'suspended']);
      }
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
type ClearMode = 'yes' | 'session-lost' | 'sign-in';

export async function clearDatabase(removeStored = true, mode: ClearMode = 'yes') {
  invalidateOfflineContext();
  if (!removeStored) return;
  while (clearing) await clearing.catch(() => {});
  const pending = localStorage.getItem(CLEAR_PENDING_KEY);
  if (pending === 'yes' || (pending === 'session-lost' && mode === 'sign-in')) mode = pending;
  const work = clearStoredDatabase(mode);
  clearing = work;
  try {
    await work;
  } finally {
    if (clearing === work) clearing = undefined;
  }
}

async function clearStoredDatabase(mode: ClearMode) {
  localStorage.setItem(CLEAR_PENDING_KEY, mode);
  announceAccount(null);
  const db = await openDatabase();
  await runTransaction(db.transaction([...stores], 'readwrite'), async (tx) => {
    const metadata = tx.objectStore('metadata');
    const cache = tx.objectStore('cache');
    const active = await requestValue<Active | undefined>(metadata.get(['__origin__', 'active']));
    const suspended = await requestValue<{ value: string } | undefined>(metadata.get(['__origin__', 'suspended']));
    const outbox = tx.objectStore('outbox');
    const owner =
      mode === 'yes'
        ? undefined
        : mode === 'session-lost'
          ? (active?.value.accountId ?? suspended?.value)
          : suspended?.value;
    const snapshots = owner
      ? (await requestValue<CacheEntry[]>(cache.index('accountId').getAll(owner))).filter(
          (entry) => adapters.get(entry.module)?.capabilities === 'read-write',
        )
      : [];
    const hasLegacyChanges = snapshots.some((entry) => {
      const operations = (entry.payload as { operations?: unknown[] }).operations;
      return Array.isArray(operations) && operations.length > 0;
    });
    if (!owner || (!(await requestValue(outbox.index('accountId').count(owner))) && !hasLegacyChanges)) {
      outbox.clear();
      cache.clear();
      metadata.clear();
    } else {
      for (const key of await requestValue(outbox.getAllKeys())) {
        if ((key as [string, string])[0] !== owner) outbox.delete(key);
      }
      const engine = await Promise.all(
        snapshots.map(({ module }) => requestValue(metadata.get([owner, `engine:${module}`]))),
      );
      cache.clear();
      metadata.clear();
      // Replay and legacy takeover may need the base snapshot. Keep it inaccessible without a confirmed login.
      for (const snapshot of snapshots) cache.put(snapshot);
      for (const record of engine) if (record) metadata.put(record);
      metadata.put({ accountId: '__origin__', key: 'suspended', value: owner });
    }
    tx.objectStore('migration').clear();
    metadata.put({ accountId: '__origin__', key: 'boundary', value: crypto.randomUUID() });
  });
  for (const adapter of adapters.values()) {
    for (const key of Object.keys(localStorage))
      if (key === adapter.legacyKey || key.startsWith(`${adapter.legacyKey}:`)) localStorage.removeItem(key);
  }
  localStorage.removeItem(CLEAR_PENDING_KEY);
  reportStorageIssue();
}
export async function recoverPendingClear() {
  while (clearing) await clearing.catch(() => {});
  const mode = localStorage.getItem(CLEAR_PENDING_KEY);
  if (mode) await clearDatabase(true, mode === 'session-lost' || mode === 'sign-in' ? mode : 'yes');
}
export async function readCache(module: CacheModule, accountId?: string) {
  checkPendingClear();
  return transact('readonly', async (tx) => {
    if (accountId) return readAccountCache(tx, module, accountId);
    const active = await requestValue<Active | undefined>(tx.objectStore('metadata').get(['__origin__', 'active']));
    if (!active) return;
    return requestValue<CacheEntry | undefined>(
      tx.objectStore('cache').get([active.value.accountId, module, 'snapshot']),
    );
  });
}
export async function readAccountCache(tx: IDBTransaction, module: CacheModule, accountId: string) {
  checkPendingClear();
  const active = await assertContext(tx);
  if (active.accountId !== accountId) throw changed();
  return requestValue<CacheEntry | undefined>(tx.objectStore('cache').get([accountId, module, 'snapshot']));
}
export class SnapshotBudgetError extends Error {}

export function makeEntry(module: CacheModule, input: unknown, maxBytes?: number, budgetError?: string): CacheEntry {
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
  const budget = maxBytes ?? adapter.budget;
  const trimmed = adapter.trim(input, (payload) => entry(payload).chargedBytes <= budget);
  const result = entry(trimmed);
  if (result.chargedBytes > budget)
    throw new SnapshotBudgetError(
      budgetError ?? 'Nie można zapisać danych offline: przekroczono budżet pamięci modułu.',
    );
  return result;
}
export function putEntry(tx: IDBTransaction, entry: CacheEntry) {
  tx.objectStore('cache').put(entry);
  tx.objectStore('metadata').put({ accountId: entry.accountId, key: `engine:${entry.module}`, value: 'legacy-idb' });
  tx.objectStore('metadata').put({
    accountId: entry.accountId,
    key: `budget:${entry.module}`,
    value: entry.chargedBytes,
  });
}
export async function writeCache(module: CacheModule, value: unknown, token = epoch, assertCurrent?: () => void) {
  checkPendingClear();
  if (token !== epoch) throw changed();
  const captured = context;
  const entry = makeEntry(module, value);
  await transact(
    'readwrite',
    async (tx) => {
      const active = await assertContext(tx, captured);
      if (entry.accountId !== active.accountId) throw changed();
      assertCurrent?.();
      putEntry(tx, entry);
    },
    token,
  );
  return entry.payload;
}

window.addEventListener('storage', (event) => {
  if (event.key === ACCOUNT_SIGNAL_KEY) {
    invalidateOfflineContext();
    window.dispatchEvent(new Event('offline-account-changed'));
  }
});
