import { importShopping, JOURNAL_PREFIX, recoverShopping } from './shoppingRecovery.js';
import {
  activateOfflineAccount,
  closeDatabase,
  readCache,
  transact,
  needsLegacyRecovery,
} from '../../offline/testing.js';
import { readAccountSession, saveAccountSession, type AccountSession } from '../../session.js';
import '../../offline/testing.js';
import { onlineManager } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { IDBObjectStore } from 'fake-indexeddb';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { readShoppingData, updateShoppingData } from './shoppingStorage.js';
import { emptyShopping, SHOPPING_STORAGE_KEY } from './shoppingSnapshot.js';
import { createShoppingStore } from './shoppingOffline.js';
import '../../offlineData.js';
const fixture = JSON.parse(readFileSync('test-fixtures/offline/legacy-valid.json', 'utf8')) as {
  accountId: string;
  referenceTime: number;
  entries: { key: string; value: unknown }[];
};
const original = () =>
  Object.fromEntries(
    fixture.entries
      .filter((entry) => entry.key === SHOPPING_STORAGE_KEY || entry.key.startsWith(JOURNAL_PREFIX))
      .map((entry) => [entry.key, JSON.stringify(entry.value)]),
  );
const session = (JSON.parse(original()[SHOPPING_STORAGE_KEY]!) as { session: AccountSession }).session;
const journalKey = () => Object.keys(original()).find((key) => key.startsWith(JOURNAL_PREFIX))!;
afterEach(() => vi.restoreAllMocks());
function seed() {
  for (const [key, value] of Object.entries(original())) localStorage.setItem(key, value);
}
describe('shopping legacy import', () => {
  it('preserves identity, time, local IDs, order and the unprojected legacy cache', () => {
    vi.spyOn(Date, 'now').mockReturnValue(fixture.referenceTime);
    const source = original();
    const data = importShopping(source);
    const snapshot = JSON.parse(source[SHOPPING_STORAGE_KEY]!);
    expect(data.version).toBe(2);
    expect(data.ranges).toEqual(
      snapshot.clientState.queries.map(
        (query: { queryKey: string[]; state: { data: unknown; dataUpdatedAt: number } }) => ({
          kind: query.queryKey[3],
          ...(query.queryKey[4] ? { listId: query.queryKey[4] } : {}),
          data: query.state.data,
          syncedAt: query.state.dataUpdatedAt,
        }),
      ),
    );
    expect(
      data.operations.map(({ sequence, review, ...variables }) => {
        expect(sequence).toBeGreaterThan(0);
        expect(review).toBeUndefined();
        return variables;
      }),
    ).toEqual(snapshot.clientState.mutations.map((m: { state: { variables: unknown } }) => m.state.variables));
    expect(data.legacyCache).toBe(true);
  });
  it('blocks corrupt journals and conflicting intentions without changing their raw source', async () => {
    seed();
    localStorage.setItem(journalKey(), '{broken');
    await expect(recoverShopping()).rejects.toThrow();
    expect(localStorage.getItem(journalKey())).toBe('{broken');
    expect(await readShoppingData()).toBeUndefined();
    const source = original();
    const op = JSON.parse(source[journalKey()]!);
    op.state.variables.change.data.name = 'Inny produkt';
    source[journalKey()] = JSON.stringify(op);
    expect(() => importShopping(source)).toThrow('Sprzeczne');
  });
  it('retains snapshot-only and journal-only intent for review', () => {
    const source = original();
    delete source[journalKey()];
    expect(importShopping(source).operations.some((op) => op.review === 'snapshot-only')).toBe(true);
    const journal = original();
    delete journal[SHOPPING_STORAGE_KEY];
    expect(importShopping(journal, session).operations.every((op) => op.review === 'missing-base')).toBe(true);
  });
  it('marks tied operations with no snapshot ordering as ambiguous', () => {
    const source = original();
    const snapshot = JSON.parse(source[SHOPPING_STORAGE_KEY]!);
    snapshot.clientState.mutations = [];
    source[SHOPPING_STORAGE_KEY] = JSON.stringify(snapshot);
    for (const key of Object.keys(source).filter((key) => key.startsWith(JOURNAL_PREFIX))) {
      const op = JSON.parse(source[key]!);
      op.state.variables.submittedAt = fixture.referenceTime;
      source[key] = JSON.stringify(op);
    }
    expect(importShopping(source).operations.every((op) => op.review === 'ambiguous-order')).toBe(true);
  });
  it('reads an IndexedDB v1 snapshot and writes v2 without changing its queued operations', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(fixture.referenceTime);
    const old = importShopping(original());
    const { ranges, ...base } = old;
    const queries = JSON.parse(original()[SHOPPING_STORAGE_KEY]!).clientState.queries;
    await activateOfflineAccount(fixture.accountId);
    await transact('readwrite', async (tx) => {
      tx.objectStore('cache').put({
        accountId: fixture.accountId,
        module: 'shopping',
        key: 'snapshot',
        schemaVersion: 1,
        payload: { ...base, version: 1, queries },
      });
    });
    await closeDatabase();
    await activateOfflineAccount(fixture.accountId);
    expect(await readShoppingData(fixture.accountId)).toEqual(old);
    expect((await readCache('shopping'))?.payload).toMatchObject({ version: 1 });
    await updateShoppingData(fixture.accountId, (saved) => saved!);
    expect((await readCache('shopping'))?.payload).toEqual({ ...base, ranges });
    expect(await readShoppingData(fixture.accountId)).toEqual(old);
  });
  it('requires closure confirmation and resumes cleanup after a process dies after verification', async () => {
    seed();
    expect(await needsLegacyRecovery()).toBe(true);
    const remove = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key: string) {
      if (key === SHOPPING_STORAGE_KEY) throw new Error('Interrupted cleanup');
      remove.call(this, key);
    });
    await expect(recoverShopping()).rejects.toThrow('Interrupted cleanup');
    expect(localStorage.getItem(SHOPPING_STORAGE_KEY)).not.toBeNull();
    vi.restoreAllMocks();
    await closeDatabase();
    await recoverShopping();
    await activateOfflineAccount(fixture.accountId);
    expect((await readShoppingData(fixture.accountId))?.operations).toHaveLength(2);
    expect(localStorage.getItem(SHOPPING_STORAGE_KEY)).toBeNull();
    await recoverShopping();
    expect((await readShoppingData(fixture.accountId))?.operations).toHaveLength(2);
  });
  it('restores shopping after explicit recovery without importing during session startup', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(fixture.referenceTime);
    onlineManager.setOnline(false);
    const store = createShoppingStore();
    try {
      seed();
      await saveAccountSession(session);
      expect((await readAccountSession())?.user.id).toBe(session.user.id);
      expect(await readCache('shopping')).toBeUndefined();
      expect(localStorage.getItem(SHOPPING_STORAGE_KEY)).not.toBeNull();

      await recoverShopping();
      await store.activate(fixture.accountId);
      expect(store.snapshot().issue).toBeUndefined();
      expect(store.snapshot().view?.pendingCount).toBe(2);
    } finally {
      store.clear();
      onlineManager.setOnline(true);
    }
  });
  it('does not discard sources on quota failure or a failed import transaction', async () => {
    seed();
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<typeof put>
    ) {
      if (this.name === 'cache') throw new DOMException('Full', 'QuotaExceededError');
      return put.apply(this, args);
    });
    await expect(recoverShopping()).rejects.toThrow('Full');
    expect(localStorage.getItem(SHOPPING_STORAGE_KEY)).toBe(original()[SHOPPING_STORAGE_KEY]);
    expect(await readShoppingData()).toBeUndefined();
    vi.restoreAllMocks();
    await recoverShopping();
    expect((await readShoppingData())?.operations).toHaveLength(2);
  });
  it('never overwrites new IDB work when an unsupported old tab writes a legacy source', async () => {
    await activateOfflineAccount(fixture.accountId);
    await updateShoppingData(fixture.accountId, () => emptyShopping(session));
    seed();
    await expect(recoverShopping()).rejects.toThrow('Starsza karta ponownie zapisała');
    expect((await readShoppingData())?.legacyCache).toBe(false);
    expect(localStorage.getItem(SHOPPING_STORAGE_KEY)).not.toBeNull();
  });
});
