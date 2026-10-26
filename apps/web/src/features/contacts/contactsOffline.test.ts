import '../../offline/testSetup.js';
import { IDBObjectStore } from 'fake-indexeddb';
import { readCache, clearDatabase, ensureMigrated, closeDatabase } from '../../offline/database.js';
import { describe, expect, it, vi } from 'vitest';
import { CONTACTS_STORAGE_KEY, createContactsStore } from './contactsOffline.js';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const account = `${id(1)}:${id(2)}`;
const meta = { familyId: id(1), createdBy: id(2), createdAt: 1, updatedAt: 1 };
const data = {
  ok: true,
  groups: [{ ...meta, id: id(3), name: 'Inne', isDefault: true }],
  contacts: [{ ...meta, id: id(4), groupId: id(3), name: 'Łucja', phone: null, address: null, relationship: null }],
};

describe('contacts IndexedDB snapshot', () => {
  it('restores complete data and its original download time after offline process restart', async () => {
    const store = createContactsStore();
    await store.activate(account);
    await store.fetch(account, async () => data);
    const saved = store.snapshot().saved;
    await closeDatabase();
    const restarted = createContactsStore();
    await restarted.activate(account);
    expect(restarted.snapshot().saved).toEqual(saved);
    expect(saved?.syncedAt).toBeGreaterThan(0);
    await restarted.fetch(account, async () => ({ ...data, contacts: [] }));
    expect(restarted.snapshot().saved?.data.contacts).toEqual([]);
    expect(localStorage.getItem(CONTACTS_STORAGE_KEY)).toBeNull();
  });
  it('preserves a good copy after invalid family/group relationships or failed requests', async () => {
    const store = createContactsStore();
    await store.activate(account);
    await store.fetch(account, async () => data);
    const original = await readCache('contacts', account);
    for (const load of [
      async () => {
        throw new Error('Network');
      },
      async () => ({ ok: true, contacts: [] }),
      async () => ({ ...data, groups: [] }),
      async () => ({ ...data, groups: [...data.groups, ...data.groups] }),
      async () => ({ ...data, contacts: [{ ...data.contacts[0], familyId: id(9) }] }),
    ]) {
      await expect(store.fetch(account, load)).rejects.toThrow();
      expect(await readCache('contacts', account)).toEqual(original);
    }
  });
  it('keeps the previous durable copy when a write fails and exposes a memory-only warning', async () => {
    const store = createContactsStore();
    await store.activate(account);
    await store.fetch(account, async () => data);
    const original = await readCache('contacts', account);
    const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Quota', 'QuotaExceededError');
    });
    try {
      await store.fetch(account, async () => ({ ...data, contacts: [] }));
      expect(store.snapshot().issue).toMatch(/Nie można zapisać/);
    } finally {
      failure.mockRestore();
    }
    expect(await readCache('contacts', account)).toEqual(original);
  });
  it('refuses an oversized snapshot without replacing the last durable copy', async () => {
    const store = createContactsStore();
    await store.activate(account);
    await store.fetch(account, async () => data);
    const original = await readCache('contacts', account);
    const contacts = Array.from({ length: 5000 }, (_, n) => ({
      ...data.contacts[0],
      id: `10000000-0000-4000-8000-${String(n + 100).padStart(12, '0')}`,
      address: 'a'.repeat(200),
    }));
    await store.fetch(account, async () => ({ ...data, contacts }));
    expect(store.snapshot().issue).toMatch(/budżet/);
    expect(await readCache('contacts', account)).toEqual(original);
  });
  it.each([true, false])('invalidates delayed responses when clear(removeStored=%s)', async (remove) => {
    const store = createContactsStore();
    await store.activate(account);
    await store.fetch(account, async () => data);
    let finish!: (value: unknown) => void;
    const pending = store.fetch(
      account,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await store.clear(remove);
    finish(data);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(store.snapshot().saved).toBeUndefined();
    expect(!!(await readCache('contacts', account))).toBe(!remove);
  });
  it('cuts off previous-account responses before they can rebuild durable data', async () => {
    const store = createContactsStore();
    await store.activate(account);
    let finish!: (value: unknown) => void;
    const pending = store.fetch(
      account,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    store.clear(false);
    await clearDatabase();
    const next = `${id(1)}:${id(9)}`;
    await store.activate(next);
    finish(data);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(await readCache('contacts', next)).toBeUndefined();
  });
  it('reloads another tab snapshot and rejects requests predating that reload', async () => {
    const store = createContactsStore();
    const other = createContactsStore();
    await store.activate(account);
    await other.activate(account);
    let finish!: (value: unknown) => void;
    const pending = store.fetch(
      account,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await other.fetch(account, async () => data);
    await store.reload();
    finish({ ...data, contacts: [] });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(store.snapshot().saved?.data).toEqual(data);
  });
  it('keeps the latest request when responses arrive out of order', async () => {
    const store = createContactsStore();
    await store.activate(account);
    let finish!: (value: unknown) => void;
    const pending = store.fetch(
      account,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await store.fetch(account, async () => ({ ...data, contacts: [] }));
    finish(data);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(store.snapshot().saved?.data.contacts).toEqual([]);
  });
  it.each(['{broken', JSON.stringify({ version: 2 }), JSON.stringify({ account, data })])(
    'preserves unsupported legacy source %s',
    async (raw) => {
      localStorage.setItem(CONTACTS_STORAGE_KEY, raw);
      await expect(ensureMigrated(true)).rejects.toThrow();
      expect(localStorage.getItem(CONTACTS_STORAGE_KEY)).toBe(raw);
    },
  );
});
