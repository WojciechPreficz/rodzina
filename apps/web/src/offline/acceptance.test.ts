import './testSetup.js';
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, onlineManager } from '@tanstack/react-query';
import { IDBObjectStore } from 'fake-indexeddb';
import { clearAccountData } from '../accountStorage.js';
import { hydrateOfflineData } from '../offlineData.js';
import { CalendarOfflineStore } from '../features/calendar/calendarOffline.js';
import { createContactsStore } from '../features/contacts/contactsOffline.js';
import { readTaskData, updateTaskData } from '../features/tasks/taskStorage.js';
import { taskOperationBlocksAlarm } from '../features/tasks/taskOffline.js';
import { takeOverShopping } from '../features/shopping/shoppingAdapter.js';
import { readShoppingData } from '../features/shopping/shoppingStorage.js';
import {
  activateOfflineAccount,
  closeDatabase,
  ensureMigrated,
  recoverPendingClear,
  requestValue,
  transact,
} from './database.js';
import { readOperations } from './outbox.js';
import { startSync, type SyncAdapter } from './sync.js';
import { adapters, chargedBytes, type CacheEntry } from './registry.js';

const fixture = JSON.parse(readFileSync('docs/offline/fixtures/legacy-valid.json', 'utf8')) as {
  accountId: string;
  entries: { key: string; value: unknown }[];
};
const account = fixture.accountId;
function seed() {
  for (const { key, value } of fixture.entries) localStorage.setItem(key, JSON.stringify(value));
}
async function upgrade() {
  await ensureMigrated(true);
  await activateOfflineAccount(account);
  await takeOverShopping(account);
  await updateTaskData(account, () => {});
}
afterEach(() => {
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

it('upgrades all five legacy stores directly, measures budgets and restarts without duplicating the outbox', async () => {
  onlineManager.setOnline(false);
  seed();
  await upgrade();
  const shopping = await readShoppingData(account);
  const tasks = await readTaskData(account);
  const operations = await transact('readonly', (tx) => readOperations(tx, account));
  expect(new Set(operations.map((op) => op.module))).toEqual(new Set(['shopping', 'tasks']));
  expect(tasks.operations.some(taskOperationBlocksAlarm)).toBe(true);
  expect(Object.keys(tasks.discards)).toHaveLength(1);
  expect(fixture.entries.every(({ key }) => localStorage.getItem(key) === null)).toBe(true);

  const records = await transact('readonly', (tx) => requestValue<CacheEntry[]>(tx.objectStore('cache').getAll()));
  expect(new Set(records.map((record) => record.module))).toEqual(new Set(adapters.keys()));
  const measurements: Record<string, number> = {};
  for (const record of records) {
    const size = chargedBytes([account, record.module, record.key], record);
    expect(record.chargedBytes).toBe(size);
    expect(size).toBeLessThanOrEqual(adapters.get(record.module)!.budget);
    measurements[record.module] = size;
    if (record.module === 'tasks' || record.module === 'shopping') {
      const queueBytes = operations
        .filter((op) => op.module === record.module)
        .reduce((sum, op) => sum + chargedBytes([account, op.operationId], op), 0);
      measurements[`${record.module}:outbox`] = queueBytes;
      expect(size + queueBytes).toBeLessThanOrEqual(6 * 1048576);
      const budget = await transact('readonly', (tx) =>
        requestValue<{ value: number }>(tx.objectStore('metadata').get([account, `budget:${record.module}`])),
      );
      expect(budget.value).toBe(size + queueBytes);
      expect((record.payload as { operations: unknown[] }).operations).toEqual([]);
    }
  }
  expect(measurements).toMatchInlineSnapshot(`
    {
      "calendar": 4662,
      "contacts": 2386,
      "family": 2148,
      "shopping": 5302,
      "shopping:outbox": 3338,
      "tasks": 3200,
      "tasks:outbox": 1732,
    }
  `);
  await closeDatabase();
  await upgrade();
  expect(await readShoppingData(account)).toEqual(shopping);
  expect(await readTaskData(account)).toEqual(tasks);
  expect(await transact('readonly', (tx) => readOperations(tx, account))).toEqual(operations);
  expect((await hydrateOfflineData())?.session.family.joinCode).toBe('TEST-CODE');
  const calendar = new CalendarOfflineStore();
  await calendar.activate(account);
  expect(calendar.snapshot().ranges).toHaveLength(1);
  const contacts = createContactsStore();
  await contacts.activate(account);
  expect(contacts.snapshot().saved?.data.contacts).toHaveLength(1);
  expect(await transact('readonly', (tx) => requestValue(tx.objectStore('migration').count()))).toBe(0);
});

it('recovers an interrupted clear without the shopping runtime or a second logout', async () => {
  seed();
  localStorage.setItem('offline-clear-pending:1', 'yes');
  await recoverPendingClear();
  expect(fixture.entries.every(({ key }) => localStorage.getItem(key) === null)).toBe(true);
  expect(localStorage.getItem('offline-clear-pending:1')).toBeNull();
});

it('keeps measured budgets accurate after retry, review and completion without a base write', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(1);
  onlineManager.setOnline(false);
  seed();
  await upgrade();
  let fail = true;
  const adapter: SyncAdapter = {
    module: 'tasks',
    prepare: async () => {},
    send: async () => {
      if (fail) throw new TypeError('Network lost');
      return {};
    },
    reconcile: async () => {},
    invalidateAccess: async () => {},
  };
  const sender = startSync(account, [adapter], () => {});
  const check = () =>
    transact('readonly', async (tx) => {
      const records = await requestValue<CacheEntry[]>(tx.objectStore('cache').getAll());
      const operations = await readOperations(tx, account);
      for (const record of records.filter((record) => ['shopping', 'tasks'].includes(record.module))) {
        const expected =
          chargedBytes([account, record.module, record.key], record) +
          operations
            .filter((op) => op.module === record.module)
            .reduce((sum, op) => sum + chargedBytes([account, op.operationId], op), 0);
        const budget = await requestValue<{ value: number }>(
          tx.objectStore('metadata').get([account, `budget:${record.module}`]),
        );
        expect(budget.value).toBe(expected);
      }
      return operations.filter((op) => op.module === 'tasks');
    });
  try {
    onlineManager.setOnline(true);
    await sender.synchronize();
    const retried = await check();
    expect(retried[0]?.status).toBe('retry-wait');
    fail = false;
    await transact('readwrite', async (tx) => {
      tx.objectStore('outbox').put({ ...retried[0]!, nextAttemptAt: 0 });
    });
    await sender.synchronize();
    expect(await check()).toEqual([]);
  } finally {
    sender.stop();
  }
});

it('clears all modules, pending work, staged imports and legacy sources through the account registry', async () => {
  seed();
  await upgrade();
  seed(); // Residual sources from an interrupted update must also be removed.
  localStorage.setItem('device-preference', 'keep');
  await transact('readwrite', async (tx) => {
    tx.objectStore('migration').put({
      accountId: account,
      module: 'tasks',
      importId: 'interrupted',
      source: 'private',
    });
  });
  const client = new QueryClient();
  client.setQueryData(['private'], 'private');
  await clearAccountData('logout', { queryClient: client });
  expect(client.getQueryCache().getAll()).toHaveLength(0);
  for (const name of ['cache', 'outbox', 'migration'] as const)
    expect(await transact('readonly', (tx) => requestValue(tx.objectStore(name).count()))).toBe(0);
  const metadata = await transact('readonly', (tx) => requestValue(tx.objectStore('metadata').getAll()));
  expect(metadata.every((entry: { accountId: string }) => entry.accountId === '__origin__')).toBe(true);
  expect(fixture.entries.every(({ key }) => localStorage.getItem(key) === null)).toBe(true);
  expect(localStorage.getItem('offline-clear-pending:1')).toBeNull();
  expect(localStorage.getItem('device-preference')).toBe('keep');
});

it('resumes a failed task handover without losing the already migrated shopping queue', async () => {
  seed();
  await ensureMigrated(true);
  await activateOfflineAccount(account);
  await takeOverShopping(account);
  const before = await transact('readonly', (tx) => readOperations(tx, account));
  const put = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<IDBObjectStore['put']>
  ) {
    if (this.name === 'cache' && args[0].module === 'tasks') throw new DOMException('Full', 'QuotaExceededError');
    return put.apply(this, args);
  });
  await expect(updateTaskData(account, () => {})).rejects.toThrow('Full');
  expect(await transact('readonly', (tx) => readOperations(tx, account))).toEqual(before);
  spy.mockRestore();
  await closeDatabase();
  await upgrade();
  const recovered = await transact('readonly', (tx) => readOperations(tx, account));
  expect(recovered.filter((op) => op.module === 'shopping')).toEqual(before);
  expect(recovered.filter((op) => op.module === 'tasks')).toHaveLength(1);
});
