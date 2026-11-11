import { adapters, chargedBytes, type CacheEntry, type CacheModule } from './registry.js';
import { reportStorageIssue } from './status.js';
import { participate } from './coordinator.js';
import { abort, changed, deleteAccountDatabase, requestValue, runTransaction, stores } from './idb.js';
import {
  accountDatabaseName,
  initializeRouting,
  openAccount,
  readRoute,
  writeRoute,
  type Active,
  type ClearMode,
  type Route,
} from './accountDatabases.js';

export { changed, requestValue, type Active };
export const PROTOCOL_KEY = 'offline-protocol:1';
export const ACCOUNT_SIGNAL_KEY = 'offline-account-signal:1';
export const CLEAR_PENDING_KEY = 'offline-clear-pending:1';
export const SESSION_KEY = 'account-session:1';
const ROUTING_LOCK = 'offline-account-routing:1';
let routing: IDBDatabase | undefined;
let connection: { accountId: string; db: IDBDatabase } | undefined;
let contextVersion = 0;
let revision: string | undefined;
let activeAccount: string | undefined;
const transactions = new Set<IDBTransaction>();
export const accountToken = () => contextVersion;
export const isAccountCurrent = (token: number) => token === contextVersion;

function closeAccount() {
  for (const transaction of transactions) abort(transaction);
  connection?.db.close();
  connection = undefined;
}

export function invalidateOfflineContext() {
  contextVersion++;
  revision = undefined;
  activeAccount = undefined;
  closeAccount();
}

export async function closeDatabase() {
  invalidateOfflineContext();
  routing?.close();
  routing = undefined;
}

function onVersionChange() {
  invalidateOfflineContext();
  if (!hasPendingClear())
    reportStorageIssue('Pamięć offline została zaktualizowana w innej karcie. Odśwież aplikację.');
  window.dispatchEvent(new Event('offline-context-invalidated'));
}

function withRoutingLock<T>(work: () => Promise<T>, mode: LockMode = 'exclusive') {
  if (!navigator.locks) throw new Error('Przeglądarka nie obsługuje bezpiecznego dostępu do pamięci offline.');
  return navigator.locks.request(ROUTING_LOCK, { mode }, work);
}

async function routingDatabase() {
  if (routing) return routing;
  const token = accountToken();
  const db = await initializeRouting();
  if (!isAccountCurrent(token)) {
    db.close();
    throw changed();
  }
  db.onversionchange = () => {
    db.close();
    if (routing !== db) return;
    routing = undefined;
    onVersionChange();
  };
  routing = db;
  return db;
}

function assertCurrent(token: number) {
  if (!isAccountCurrent(token)) throw changed();
}

async function currentRoute(db: IDBDatabase, token: number) {
  assertCurrent(token);
  checkPendingClear();
  const route = (await readRoute(db))!;
  assertCurrent(token);
  if (route.pending) throw pendingClearError();
  if (revision !== undefined && revision !== route.revision) throw changed();
  revision = route.revision;
  return route;
}

async function withCurrentRoute<T>(token: number, work: (route: Route) => Promise<T>) {
  assertCurrent(token);
  const db =
    routing ??
    (await withRoutingLock(async () => {
      assertCurrent(token);
      checkPendingClear();
      return routingDatabase();
    }));
  return withRoutingLock(async () => work(await currentRoute(db, token)), 'shared');
}

export async function offlineOwner(token = accountToken()) {
  return withCurrentRoute(token, async (route) => route.accountId);
}

async function accountConnection(accountId: string, token: number) {
  assertCurrent(token);
  if (connection?.accountId === accountId) return connection.db;
  const db = await openAccount(accountId);
  if (!isAccountCurrent(token) || (connection && connection.accountId !== accountId)) {
    db.close();
    throw changed();
  }
  if (connection) {
    db.close();
    return connection.db;
  }
  db.onversionchange = () => {
    db.close();
    if (connection?.db === db) onVersionChange();
  };
  connection = { accountId, db };
  return db;
}

export async function transact<T>(
  mode: IDBTransactionMode,
  action: (transaction: IDBTransaction) => Promise<T>,
  token = accountToken(),
): Promise<T> {
  return withCurrentRoute(token, async ({ accountId }) => {
    if (!accountId) throw changed();
    const db = await accountConnection(accountId, token);
    assertCurrent(token);
    const tx = db.transaction([...stores], mode);
    transactions.add(tx);
    try {
      const result = await runTransaction(tx, action);
      assertCurrent(token);
      return result;
    } finally {
      transactions.delete(tx);
    }
  });
}

export function assertContext(tx: IDBTransaction, accountId = activeAccount) {
  // transact holds the routing lock and verifies its revision. Local invalidation
  // drops the active account and aborts transactions on the old connection.
  if (!accountId || activeAccount !== accountId || tx.db !== connection?.db) throw changed();
  return accountId;
}
export function checkPendingClear() {
  if (localStorage.getItem(CLEAR_PENDING_KEY)) throw pendingClearError();
}
const pendingClearError = () =>
  new DOMException(
    'Usuwanie danych konta nie zostało zakończone. Zamknij pozostałe karty i ponów próbę.',
    'AbortError',
  );
export function hasPendingClear() {
  try {
    return !!localStorage.getItem(CLEAR_PENDING_KEY);
  } catch {
    return true;
  }
}

async function selectAccount(db: IDBDatabase, accountId: string) {
  const route = { accountId, revision: crypto.randomUUID() };
  revision = route.revision;
  await writeRoute(db, route);
}

// LocalStorage recovery validates the source owner before staging records. The active
// session marker remains in the account DB and is written only by the import commit.
export async function prepareOfflineRecovery(accountId: string, token: number) {
  await withRoutingLock(async () => {
    assertCurrent(token);
    const db = await routingDatabase();
    const route = await currentRoute(db, token);
    if (route.accountId && route.accountId !== accountId) throw changed();
    if (!route.accountId) await selectAccount(db, accountId);
    assertCurrent(token);
  });
}

export async function activateOfflineAccount(accountId: string, confirmed = false) {
  const token = accountToken();
  checkPendingClear();
  await participate(invalidateOfflineContext);
  return withRoutingLock(async () => {
    assertCurrent(token);
    const db = await routingDatabase();
    const route = await currentRoute(db, token);
    if (route.accountId && route.accountId !== accountId) {
      if (!confirmed || activeAccount) throw changed();
      closeAccount();
      await beginClear(db, route, 'yes');
      assertCurrent(token);
    }
    if (route.accountId !== accountId) await selectAccount(db, accountId);
    const account = await accountConnection(accountId, token);
    const suspended = await runTransaction(account.transaction('metadata'), async (tx) =>
      requestValue<{ value: string } | undefined>(tx.objectStore('metadata').get(['__origin__', 'suspended'])),
    );
    assertCurrent(token);
    if (suspended) {
      if (!confirmed || suspended.value !== accountId) throw changed();
      await selectAccount(db, accountId);
    }
    assertCurrent(token);
    const tx = account.transaction('metadata', 'readwrite', { durability: 'strict' });
    transactions.add(tx);
    try {
      const created = await runTransaction(tx, async (tx) => {
        const store = tx.objectStore('metadata');
        const old = await requestValue<Active | undefined>(store.get(['__origin__', 'active']));
        if (old && old.value.accountId !== accountId) throw changed();
        if (suspended) store.delete(['__origin__', 'suspended']);
        if (!old) store.put({ accountId: '__origin__', key: 'active', value: { accountId } });
        return !old;
      });
      assertCurrent(token);
      activeAccount = accountId;
      if (confirmed && created) announceAccount(accountId);
      return token;
    } finally {
      transactions.delete(tx);
    }
  });
}

function announceAccount(accountId: string | null) {
  localStorage.setItem(ACCOUNT_SIGNAL_KEY, JSON.stringify({ accountId, nonce: crypto.randomUUID() }));
}

export async function clearDatabase(removeStored = true, mode: ClearMode = 'yes') {
  const expectedRevision = revision;
  invalidateOfflineContext();
  if (!removeStored) return;
  await withRoutingLock(async () => {
    const db = await routingDatabase();
    const route = (await readRoute(db))!;
    if (expectedRevision && expectedRevision !== route.revision) throw changed();
    const legacyPending = pendingMode();
    const pending = route.pending ?? legacyPending;
    if (mode === 'session-lost' && !pending && (!route.accountId || !expectedRevision)) return;
    if (pending) {
      if (route.pending) await finishClear(db, { ...route, pending: route.pending });
      else await beginClear(db, route, legacyPending!);
      if (mode !== 'yes' || pending === 'yes' || pending === 'delete') return;
    }
    await beginClear(db, (await readRoute(db))!, mode);
  });
}

async function beginClear(db: IDBDatabase, route: Route, mode: ClearMode) {
  const next = { ...route, revision: crypto.randomUUID(), pending: mode };
  await writeRoute(db, next);
  announceAccount(null);
  await finishClear(db, next);
}

async function suspendChanges(accountId: string, mode: ClearMode) {
  const db = await openAccount(accountId);
  db.onversionchange = () => db.close();
  try {
    return await runTransaction(db.transaction([...stores], 'readwrite', { durability: 'strict' }), async (tx) => {
      const meta = tx.objectStore('metadata');
      const suspended = await requestValue<{ value: string } | undefined>(meta.get(['__origin__', 'suspended']));
      if (suspended?.value === accountId) return true;
      if (mode === 'sign-in') return false;
      const active = await requestValue<Active | undefined>(meta.get(['__origin__', 'active']));
      if (active?.value.accountId !== accountId) return false;
      const cache = tx.objectStore('cache');
      const snapshots = await requestValue<CacheEntry[]>(cache.index('accountId').getAll(accountId));
      const writable = snapshots.filter((entry) => adapters.get(entry.module)?.capabilities === 'read-write');
      const hasLegacyChanges = writable.some((entry) => {
        const operations = (entry.payload as { operations?: unknown[] }).operations;
        return Array.isArray(operations) && operations.length > 0;
      });
      if (!(await requestValue(tx.objectStore('outbox').index('accountId').count(accountId))) && !hasLegacyChanges)
        return false;
      for (const entry of snapshots)
        if (!writable.includes(entry)) cache.delete([entry.accountId, entry.module, entry.key]);
      meta.delete([accountId, SESSION_KEY]);
      meta.delete(['__origin__', 'active']);
      meta.put({ accountId: '__origin__', key: 'boundary', value: crypto.randomUUID() });
      meta.put({ accountId: '__origin__', key: 'suspended', value: accountId });
      return true;
    });
  } finally {
    db.close();
  }
}

async function finishClear(db: IDBDatabase, route: Route & { pending: NonNullable<Route['pending']> }) {
  const { accountId, pending } = route;
  let next: Route = accountId ? { accountId, revision: route.revision } : { revision: route.revision };
  if (accountId && (pending === 'delete' || pending === 'yes' || !(await suspendChanges(accountId, pending)))) {
    // A resumed deletion must never reopen a database that was already deleted.
    if (pending !== 'delete') await writeRoute(db, { ...route, pending: 'delete' });
    await deleteAccountDatabase(accountDatabaseName(accountId));
    next = { revision: route.revision };
  }
  for (const adapter of adapters.values()) {
    for (const key of Object.keys(localStorage))
      if (key === adapter.legacyKey || key.startsWith(`${adapter.legacyKey}:`)) localStorage.removeItem(key);
  }
  await writeRoute(db, next);
  localStorage.removeItem(CLEAR_PENDING_KEY);
  reportStorageIssue();
}

function pendingMode(): ClearMode | undefined {
  const mode = localStorage.getItem(CLEAR_PENDING_KEY);
  if (mode) return mode === 'session-lost' || mode === 'sign-in' ? mode : 'yes';
}

export async function recoverPendingClear() {
  await withRoutingLock(async () => {
    const db = await routingDatabase();
    const route = (await readRoute(db))!;
    const legacyPending = pendingMode();
    if (route.pending || legacyPending) {
      invalidateOfflineContext();
      if (route.pending) await finishClear(db, { ...route, pending: route.pending });
      else await beginClear(db, route, legacyPending!);
    }
  });
}

export async function readCache(module: CacheModule, accountId?: string) {
  const token = accountToken();
  if (!(await offlineOwner(token))) return;
  return transact(
    'readonly',
    async (tx) => {
      if (accountId) return readAccountCache(tx, module, accountId);
      const active = await requestValue<Active | undefined>(tx.objectStore('metadata').get(['__origin__', 'active']));
      if (!active) return;
      return requestValue<CacheEntry | undefined>(
        tx.objectStore('cache').get([active.value.accountId, module, 'snapshot']),
      );
    },
    token,
  );
}
export function readAccountCache(tx: IDBTransaction, module: CacheModule, accountId: string) {
  assertContext(tx, accountId);
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
export async function writeCache(
  module: CacheModule,
  value: unknown,
  token = accountToken(),
  assertCurrent?: () => void,
) {
  const entry = makeEntry(module, value);
  await transact(
    'readwrite',
    async (tx) => {
      assertContext(tx, entry.accountId);
      assertCurrent?.();
      putEntry(tx, entry);
    },
    token,
  );
  return entry.payload;
}

window.addEventListener('storage', (event) => {
  if (event.key === ACCOUNT_SIGNAL_KEY && isLatestAccountSignal(event)) {
    invalidateOfflineContext();
    window.dispatchEvent(new Event('offline-account-changed'));
  }
});

export function isLatestAccountSignal(event: StorageEvent) {
  return !event.storageArea || localStorage.getItem(ACCOUNT_SIGNAL_KEY) === event.newValue;
}
