import './testSetup.js';
import { IDBObjectStore } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import {
  accountToken,
  activateOfflineAccount,
  clearDatabase,
  closeDatabase,
  offlineOwner,
  recoverPendingClear,
  transact,
} from './database.js';
import { createAccountStores, open, requestValue, runTransaction, stores } from './idb.js';
import { accountDatabaseName, writeRoute } from './accountDatabases.js';

const legacyName = 'rodzina-offline';
const accountId = 'family:user';
const name = accountDatabaseName(accountId);
const records = {
  cache: [{ accountId, module: 'meals', key: 'snapshot', payload: { account: accountId, version: 1 } }],
  outbox: [
    { accountId, operationId: 'first', sequence: 7, status: 'retry-wait', attempts: 3, nextAttemptAt: 1234 },
    { accountId, operationId: 'second', sequence: 8, status: 'needs-review', dependsOn: ['first'] },
  ],
  metadata: [
    { accountId: '__origin__', key: 'active', value: { accountId, generation: 'legacy-generation' } },
    { accountId, key: 'account-session:1', value: { user: { id: 'user' }, family: { id: 'family' } } },
    { accountId, key: 'outbox-sequence', value: 8 },
    { accountId, key: 'calendar-photo-import:1', value: { drafts: ['pending'] } },
    { accountId, key: 'sender-lease', value: { owner: 'legacy-tab' } },
  ],
  migration: [{ accountId, module: 'tasks', importId: 'v1', phase: 'verified' }],
};

async function seedLegacy() {
  const db = await open(legacyName, 3, createAccountStores);
  await runTransaction(db.transaction([...stores], 'readwrite'), async (tx) => {
    for (const store of stores) for (const record of records[store]) tx.objectStore(store).add(record);
  });
  return db;
}

async function expectCopied() {
  expect(await offlineOwner()).toBe(accountId);
  const db = await open(legacyName, 6, () => {});
  expect([...db.objectStoreNames]).toEqual(['routing']);
  db.close();
  for (const store of stores) {
    const actual = await transact('readonly', async (tx) => requestValue(tx.objectStore(store).getAll()));
    for (const record of records[store]) expect(actual).toContainEqual(record);
    if (store !== 'metadata') expect(actual).toHaveLength(records[store].length);
  }
}

afterEach(() => vi.restoreAllMocks());

it('waits for a version 3 writer to close and prevents it reopening after copying', async () => {
  const legacy = await seedLegacy();
  try {
    await expect(offlineOwner()).rejects.toThrow('zablokowana');
    expect(await indexedDB.databases()).toEqual([{ name: legacyName, version: 3 }]);
  } finally {
    legacy.close();
  }
  await expectCopied();
  await expect(open(legacyName, 3, () => {})).rejects.toMatchObject({ name: 'VersionError' });
});

it.each(['copy', 'switch'] as const)('resumes after interruption during %s', async (stage) => {
  (await seedLegacy()).close();
  const add = IDBObjectStore.prototype.add;
  const put = IDBObjectStore.prototype.put;
  if (stage === 'copy') {
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.transaction.db.name === name && this.name === 'outbox') throw new Error('Interrupted copy');
      return add.call(this, value, key);
    });
  } else {
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if (this.name === 'routing') throw new Error('Interrupted switch');
      return put.call(this, value, key);
    });
  }
  await expect(offlineOwner()).rejects.toThrow('Interrupted');
  const source = await open(legacyName, 4, () => {});
  expect([...source.objectStoreNames]).toEqual(expect.arrayContaining([...stores]));
  source.close();
  await closeDatabase();
  vi.restoreAllMocks();
  await expectCopied();
  await closeDatabase();
  await expectCopied();
});

it('never replays the source after the route commits, even if cleanup was blocked and the copy changed', async () => {
  (await seedLegacy()).close();
  let blocker: Promise<IDBDatabase> | undefined;
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    if (this.name === 'routing') blocker = open(legacyName, 4, () => {});
    return put.call(this, value, key);
  });
  await expect(offlineOwner()).rejects.toThrow('zablokowana');
  const source = (await blocker)!;
  try {
    expect(source.objectStoreNames.contains('outbox')).toBe(true);
    const target = await open(name, 1, createAccountStores);
    try {
      await runTransaction(target.transaction('outbox', 'readwrite'), async (tx) => {
        tx.objectStore('outbox').delete([accountId, 'first']);
        tx.objectStore('outbox').put({ ...records.outbox[1], status: 'pending' });
      });
    } finally {
      target.close();
    }
  } finally {
    source.close();
  }
  vi.restoreAllMocks();
  await closeDatabase();
  expect(await offlineOwner()).toBe(accountId);
  expect(await transact('readonly', async (tx) => requestValue(tx.objectStore('outbox').getAll()))).toEqual([
    { ...records.outbox[1], status: 'pending' },
  ]);
});

it('keeps an already suspended legacy queue inaccessible until the owner is confirmed', async () => {
  const legacy = await seedLegacy();
  await runTransaction(legacy.transaction('metadata', 'readwrite'), async (tx) => {
    const metadata = tx.objectStore('metadata');
    metadata.delete(['__origin__', 'active']);
    metadata.delete([accountId, 'account-session:1']);
    metadata.put({ accountId: '__origin__', key: 'suspended', value: accountId });
  });
  legacy.close();
  await expect(activateOfflineAccount(accountId)).rejects.toMatchObject({ name: 'AbortError' });
  await closeDatabase();
  await activateOfflineAccount(accountId, true);
  expect(await transact('readonly', async (tx) => requestValue(tx.objectStore('outbox').getAll()))).toEqual(
    records.outbox,
  );
});

it('resumes a blocked deletion and fences operations from before a quick return to the same account', async () => {
  await activateOfflineAccount(accountId);
  const stale = accountToken();
  const blocker = await open(name, 1, createAccountStores);
  try {
    await expect(clearDatabase()).rejects.toThrow('zablokowane');
    await expect(activateOfflineAccount(accountId, true)).rejects.toThrow('nie zostało zakończone');
  } finally {
    blocker.close();
  }
  await closeDatabase();
  // The durable journal works even if the localStorage notification was lost.
  localStorage.clear();
  const opening = vi.spyOn(indexedDB, 'open');
  await recoverPendingClear();
  expect(await offlineOwner()).toBeUndefined();
  expect(opening).not.toHaveBeenCalledWith(name, expect.anything());
  expect(await indexedDB.databases()).toEqual([{ name: legacyName, version: 6 }]);
  await activateOfflineAccount(accountId, true);
  const action = vi.fn(async () => {});
  await expect(transact('readonly', action, stale)).rejects.toMatchObject({ name: 'AbortError' });
  await expect(transact('readwrite', action, stale)).rejects.toMatchObject({ name: 'AbortError' });
  expect(action).not.toHaveBeenCalled();
});

it('rejects work after another tab changes the route before its storage event is delivered', async () => {
  await activateOfflineAccount(accountId);
  const routing = await open(legacyName, 6, () => {});
  const other = 'family:other';
  try {
    await writeRoute(routing, { accountId: other, revision: 'new-session' });
  } finally {
    routing.close();
  }
  const opening = vi.spyOn(indexedDB, 'open');
  const action = vi.fn(async () => {});
  await expect(transact('readonly', action)).rejects.toMatchObject({ name: 'AbortError' });
  await expect(activateOfflineAccount(accountId, true)).rejects.toMatchObject({ name: 'AbortError' });
  await expect(clearDatabase()).rejects.toMatchObject({ name: 'AbortError' });
  expect(action).not.toHaveBeenCalled();
  expect(opening).not.toHaveBeenCalled();
  expect(await offlineOwner()).toBe(other);
});

it('fences a version 5 lease sender before the new routing version can access the existing queue', async () => {
  const old = await open(legacyName, 5, (db) => db.createObjectStore('routing'));
  await writeRoute(old, { accountId, revision: 'existing-route' });
  const target = await open(name, 1, createAccountStores);
  await runTransaction(target.transaction('outbox', 'readwrite'), async (tx) => {
    for (const operation of records.outbox) tx.objectStore('outbox').add(operation);
  });
  target.close();

  try {
    await expect(activateOfflineAccount(accountId)).rejects.toThrow('zablokowana');
  } finally {
    old.close();
  }
  await activateOfflineAccount(accountId);
  await expect(open(legacyName, 5, () => {})).rejects.toMatchObject({ name: 'VersionError' });
  expect(await transact('readonly', async (tx) => requestValue(tx.objectStore('outbox').getAll()))).toEqual(
    records.outbox,
  );
});
