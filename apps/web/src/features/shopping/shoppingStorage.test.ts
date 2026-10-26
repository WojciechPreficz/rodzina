import '../../offline/testSetup.js';
import { readFileSync } from 'node:fs';
import { IDBObjectStore } from 'fake-indexeddb';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { ensureMigrated, activateOfflineAccount, closeDatabase } from '../../offline/database.js';
import {
  importShopping,
  readShoppingData,
  SHOPPING_STORAGE_KEY,
  JOURNAL_PREFIX,
  updateShoppingData,
  emptyShopping,
} from './shoppingStorage.js';
import type { ShoppingSession } from './shoppingOffline.js';
import '../../offlineData.js';
const fixture = JSON.parse(readFileSync('docs/offline/fixtures/legacy-valid.json', 'utf8')) as {
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
const session = (JSON.parse(original()[SHOPPING_STORAGE_KEY]!) as { session: ShoppingSession }).session;
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
    expect(data.queries).toEqual(snapshot.clientState.queries);
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
    await expect(ensureMigrated(true)).rejects.toThrow();
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
  it('requires closure confirmation and resumes cleanup after a process dies after verification', async () => {
    seed();
    await expect(ensureMigrated()).rejects.toThrow('Zamknij starsze karty');
    const remove = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key: string) {
      if (key === SHOPPING_STORAGE_KEY) throw new Error('Interrupted cleanup');
      remove.call(this, key);
    });
    await expect(ensureMigrated(true)).rejects.toThrow('Interrupted cleanup');
    expect(localStorage.getItem(SHOPPING_STORAGE_KEY)).not.toBeNull();
    vi.restoreAllMocks();
    await closeDatabase();
    await ensureMigrated();
    await activateOfflineAccount(fixture.accountId);
    expect((await readShoppingData(fixture.accountId))?.operations).toHaveLength(2);
    expect(localStorage.getItem(SHOPPING_STORAGE_KEY)).toBeNull();
    await ensureMigrated();
    expect((await readShoppingData(fixture.accountId))?.operations).toHaveLength(2);
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
    await expect(ensureMigrated(true)).rejects.toThrow('Full');
    expect(localStorage.getItem(SHOPPING_STORAGE_KEY)).toBe(original()[SHOPPING_STORAGE_KEY]);
    expect(await readShoppingData()).toBeUndefined();
    vi.restoreAllMocks();
    await ensureMigrated();
    expect((await readShoppingData())?.operations).toHaveLength(2);
  });
  it('never overwrites new IDB work when an unsupported old tab writes a legacy source', async () => {
    await activateOfflineAccount(fixture.accountId);
    await updateShoppingData(fixture.accountId, () => emptyShopping(session));
    seed();
    await expect(ensureMigrated(true)).rejects.toThrow('Starsza karta ponownie zapisała');
    expect((await readShoppingData())?.legacyCache).toBe(false);
    expect(localStorage.getItem(SHOPPING_STORAGE_KEY)).not.toBeNull();
  });
});
