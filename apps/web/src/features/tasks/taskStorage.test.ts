import '../../offline/testSetup.js';
import { readFileSync } from 'node:fs';
import { IDBObjectStore } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ensureMigrated,
  activateOfflineAccount,
  closeDatabase,
  readCache,
  transact,
  requestValue,
  clearDatabase,
} from '../../offline/database.js';
import { importTasks, readTaskData, updateTaskData } from './taskStorage.js';
import { TASK_STORAGE_KEY } from './taskOffline.js';
import { CONTACTS_STORAGE_KEY } from '../contacts/contactsOffline.js';
import '../contacts/contactsOffline.js';
const fixture = JSON.parse(readFileSync('docs/offline/fixtures/legacy-valid.json', 'utf8')) as {
  accountId: string;
  referenceTime: number;
  entries: { key: string; value: unknown }[];
};
const source = () =>
  Object.fromEntries(
    fixture.entries
      .filter((entry) => entry.key === TASK_STORAGE_KEY || entry.key.startsWith(`${TASK_STORAGE_KEY}:`))
      .map((entry) => [entry.key, JSON.stringify(entry.value)]),
  );
const contact = fixture.entries.find((entry) => entry.key === CONTACTS_STORAGE_KEY)!;
const journalKey = () => Object.keys(source()).find((key) => key.includes(':operation:'))!;
function seed() {
  for (const [key, value] of Object.entries(source())) localStorage.setItem(key, value);
  localStorage.setItem(contact.key, JSON.stringify(contact.value));
}
afterEach(() => vi.restoreAllMocks());
describe('O.4 legacy import', () => {
  it('requires explicit exclusivity, preserves raw sources until import can run, and keeps IDs, timestamps, discards and contacts time', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(fixture.referenceTime);
    seed();
    await expect(ensureMigrated()).rejects.toThrow(/Zamknij starsze karty/);
    expect(localStorage.getItem(journalKey())).toBe(source()[journalKey()]);
    await ensureMigrated(true);
    await activateOfflineAccount(fixture.accountId);
    const expected = importTasks(source(), fixture.accountId);
    expect(await readTaskData(fixture.accountId)).toEqual(expected);
    expect((await readCache('contacts', fixture.accountId))?.payload).toEqual(contact.value);
    for (const key of [...Object.keys(source()), contact.key]) expect(localStorage.getItem(key)).toBeNull();
    await closeDatabase();
    await ensureMigrated();
    await activateOfflineAccount(fixture.accountId);
    expect(await readTaskData(fixture.accountId)).toEqual(expected);
  });
  it.each(['staged', 'committed', 'verified'])(
    'resumes an interrupted %s import without replaying or losing work',
    async (phase) => {
      vi.spyOn(Date, 'now').mockReturnValue(fixture.referenceTime);
      seed();
      const original = IDBObjectStore.prototype.put;
      let fired = false;
      const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        value,
        ...args
      ) {
        if (!fired && this.name === 'migration' && value.module === 'tasks' && value.phase === phase) {
          fired = true;
          throw new DOMException('Interrupted', 'AbortError');
        }
        return original.call(this, value, ...args);
      });
      await expect(ensureMigrated(true)).rejects.toThrow();
      failure.mockRestore();
      expect(fired).toBe(true);
      expect(localStorage.getItem(journalKey())).not.toBeNull();
      await closeDatabase();
      await ensureMigrated(true);
      await activateOfflineAccount(fixture.accountId);
      expect(await readTaskData(fixture.accountId)).toEqual(importTasks(source(), fixture.accountId));
      expect(await transact('readonly', async (tx) => requestValue(tx.objectStore('migration').getAll()))).toEqual([]);
    },
  );
  it('resumes cleanup after verified import even when some legacy keys were already removed', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(fixture.referenceTime);
    seed();
    const remove = Storage.prototype.removeItem;
    let removed = 0;
    const failure = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
      if (key.startsWith(TASK_STORAGE_KEY) && ++removed === 2) throw new Error('Interrupted');
      return remove.call(this, key);
    });
    await expect(ensureMigrated(true)).rejects.toThrow('Interrupted');
    failure.mockRestore();
    await closeDatabase();
    await ensureMigrated(true);
    await activateOfflineAccount(fixture.accountId);
    expect(await readTaskData(fixture.accountId)).toEqual(importTasks(source(), fixture.accountId));
  });
  it('aborts quota failure without changing the target or deleting the source', async () => {
    seed();
    const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Quota', 'QuotaExceededError');
    });
    await expect(ensureMigrated(true)).rejects.toThrow();
    failure.mockRestore();
    expect(localStorage.getItem(journalKey())).toBe(source()[journalKey()]);
    await ensureMigrated(true);
    await activateOfflineAccount(fixture.accountId);
    expect(await readTaskData(fixture.accountId)).toBeDefined();
  });
  it('does not silently skip a corrupt journal or an account/key mismatch', async () => {
    seed();
    localStorage.setItem(journalKey(), '{broken');
    await expect(ensureMigrated(true)).rejects.toThrow();
    expect(localStorage.getItem(journalKey())).toBe('{broken');
    const foreign = source();
    const raw = foreign[journalKey()]!;
    delete foreign[journalKey()];
    foreign[journalKey().replace(fixture.accountId, 'other:user')] = raw;
    expect(() => importTasks(foreign)).toThrow(/innego konta/);
  });
  it('rejects reintroduced legacy data after a completed migration', async () => {
    seed();
    await ensureMigrated(true);
    localStorage.setItem(journalKey(), source()[journalKey()]!);
    await expect(ensureMigrated(true)).rejects.toThrow('Starsza karta');
    expect(localStorage.getItem(journalKey())).not.toBeNull();
  });
  it('keeps the last valid data and pending work at the budget boundary', async () => {
    seed();
    await ensureMigrated(true);
    await activateOfflineAccount(fixture.accountId);
    const before = await readTaskData(fixture.accountId);
    await expect(
      updateTaskData(fixture.accountId, (data) => {
        const op = data.operations[0]!;
        data.operations = Array.from({ length: 400 }, () => ({
          ...op,
          id: crypto.randomUUID(),
          change: { type: 'update', data: { notes: 'x'.repeat(10000) } },
        }));
      }),
    ).rejects.toThrow('budżet');
    expect(await readTaskData(fixture.accountId)).toEqual(before);
  });
  it('removes all imported account content, work and migration copies on logout', async () => {
    seed();
    await ensureMigrated(true);
    await clearDatabase();
    const records = await transact('readonly', async (tx) =>
      Promise.all(['cache', 'outbox', 'migration'].map((name) => requestValue(tx.objectStore(name).getAll()))),
    );
    expect(records).toEqual([[], [], []]);
    expect(Object.keys(localStorage).filter((key) => key.startsWith('rodzina:'))).toEqual([]);
  });
});
