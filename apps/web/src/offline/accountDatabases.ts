import { createAccountStores, open, requestValue, runTransaction, stores } from './idb.js';

const LEGACY_DB = 'rodzina-offline';
const ROUTING = 'routing';
const FENCED_VERSION = 4;
// Version 5 clients close on versionchange and cannot reopen to send via the old lease.
const ROUTING_VERSION = 6;
const COPY_KEY = ['__origin__', 'account-copy:1'];
export const accountDatabaseName = (accountId: string) => `rodzina-${accountId}`;
export const openAccount = (accountId: string) => open(accountDatabaseName(accountId), 1, createAccountStores);
export type ClearMode = 'yes' | 'session-lost' | 'sign-in';
export type Route = { accountId?: string; revision: string; pending?: ClearMode | 'delete' };
export type Active = { accountId: '__origin__'; key: 'active'; value: { accountId: string } };

export function readRoute(db: IDBDatabase) {
  return runTransaction(db.transaction(ROUTING), async (tx) =>
    requestValue<Route | undefined>(tx.objectStore(ROUTING).get('account')),
  );
}

export function writeRoute(db: IDBDatabase, route: Route) {
  return runTransaction(db.transaction(ROUTING, 'readwrite', { durability: 'strict' }), async (tx) => {
    tx.objectStore(ROUTING).put(route, 'account');
  });
}

async function copyLegacy(source: IDBDatabase): Promise<Route> {
  const revision = crypto.randomUUID();
  if (!source.objectStoreNames.contains('cache')) return { revision };
  const snapshots = await runTransaction(source.transaction([...stores]), (tx) =>
    Promise.all(
      stores.map(async (name) => ({
        name,
        records: await requestValue<LegacyRecord[]>(tx.objectStore(name).getAll()),
      })),
    ),
  );
  const accounts = new Set(
    snapshots.flatMap(({ records }) => records.map((record) => record.accountId)).filter((id) => id !== '__origin__'),
  );
  const metadata = snapshots.find(({ name }) => name === 'metadata')!.records;
  const active = metadata.find((record) => record.accountId === '__origin__' && record.key === 'active') as
    Active | undefined;
  const suspended = metadata.find((record) => record.accountId === '__origin__' && record.key === 'suspended');
  if (active) accounts.add(active.value.accountId);
  if (typeof suspended?.value === 'string') accounts.add(suspended.value);
  if (accounts.size > 1)
    throw new Error('Stara pamięć zawiera dane różnych kont. Zachowaj dane urządzenia do odzyskania.');
  const [accountId] = accounts;
  if (!accountId) return { revision };
  const target = await openAccount(accountId);
  target.onversionchange = () => target.close();
  try {
    await runTransaction(target.transaction([...stores], 'readwrite', { durability: 'strict' }), async (tx) => {
      const meta = tx.objectStore('metadata');
      // The marker and every copied record commit together. Never replay a committed copy.
      if (await requestValue(meta.getKey(COPY_KEY))) return;
      for (const { name, records } of snapshots) {
        const store = tx.objectStore(name);
        for (const record of records) store.add(record);
      }
      meta.add({ accountId: COPY_KEY[0], key: COPY_KEY[1], value: true });
    });
  } finally {
    target.close();
  }
  return { accountId, revision };
}

type LegacyRecord = { accountId: string; key?: string; value?: unknown };

export async function initializeRouting() {
  let source: IDBDatabase;
  try {
    // The upgrade waits for all legacy connections. Their explicit versions cannot reopen after it commits.
    source = await open(LEGACY_DB, FENCED_VERSION, (db) => db.createObjectStore(ROUTING));
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'VersionError') throw error;
    return open(LEGACY_DB, ROUTING_VERSION, () => {});
  }
  source.onversionchange = () => source.close();
  try {
    if (!(await readRoute(source))) await writeRoute(source, await copyLegacy(source));
  } finally {
    source.close();
  }
  // Keep a version fence and the routing record. No source stores survive the upgrade.
  return open(LEGACY_DB, ROUTING_VERSION, (db) => {
    for (const name of stores) if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
  });
}
