import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTACTS_STORAGE_KEY, createContactsStore } from './contactsOffline.js';

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const account = `${id(1)}:${id(2)}`;
const meta = { familyId: id(1), createdBy: id(2), createdAt: 1, updatedAt: 1 };
const data = {
  ok: true,
  groups: [{ ...meta, id: id(3), name: 'Inne', isDefault: true }],
  contacts: [{ ...meta, id: id(4), groupId: id(3), name: 'Łucja', phone: null, address: null, relationship: null }],
};
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('contacts snapshot', () => {
  it('restores a complete snapshot and timestamp after restart, including an empty contact list', async () => {
    const store = createContactsStore();
    store.activate(account);
    expect(store.snapshot().saved).toBeUndefined();
    await store.fetch(account, async () => data);
    const restarted = createContactsStore();
    restarted.activate(account);
    expect(restarted.snapshot().saved).toEqual(store.snapshot().saved);
    expect(restarted.snapshot().saved?.syncedAt).toBeGreaterThan(0);
    await restarted.fetch(account, async () => ({ ...data, contacts: [] }));
    expect(restarted.snapshot().saved?.data.contacts).toEqual([]);
  });

  it.each(['{broken', JSON.stringify({ version: 2 }), JSON.stringify({ account, data })])(
    'reports corrupt or incomplete storage: %s',
    (raw) => {
      localStorage.setItem(CONTACTS_STORAGE_KEY, raw);
      const store = createContactsStore();
      store.activate(account);
      expect(store.snapshot().saved).toBeUndefined();
      expect(store.snapshot().issue).toMatch(/Nie można odczytać/);
    },
  );

  it('preserves good data after failed requests, partial responses and inconsistent family/group membership', async () => {
    const store = createContactsStore();
    store.activate(account);
    await store.fetch(account, async () => data);
    const original = localStorage.getItem(CONTACTS_STORAGE_KEY);
    for (const load of [
      async () => {
        throw new Error('Network error');
      },
      async () => ({ ok: true, contacts: [] }),
      async () => ({ ...data, groups: [] }),
      async () => ({ ...data, groups: [...data.groups, ...data.groups] }),
      async () => ({ ...data, contacts: [{ ...data.contacts[0], familyId: id(9) }] }),
    ]) {
      await expect(store.fetch(account, load)).rejects.toThrow();
      expect(localStorage.getItem(CONTACTS_STORAGE_KEY)).toBe(original);
      expect(store.snapshot().saved?.data).toEqual(data);
    }
  });

  it('reports denied reads and writes and keeps fetched data available in memory', async () => {
    const store = createContactsStore(() => {
      throw new Error('Denied');
    });
    store.activate(account);
    expect(store.snapshot().issue).toMatch(/Nie można odczytać/);
    await store.fetch(account, async () => data);
    expect(store.snapshot().saved?.data).toEqual(data);
    expect(store.snapshot().issue).toMatch(/Nie można zapisać/);
    store.clear();
    expect(store.snapshot().saved).toBeUndefined();
    expect(store.snapshot().issue).toMatch(/Nie można usunąć/);
  });

  it('does not overwrite a durable snapshot when saving the new response fails', async () => {
    const store = createContactsStore();
    store.activate(account);
    await store.fetch(account, async () => data);
    const original = localStorage.getItem(CONTACTS_STORAGE_KEY);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Quota');
    });
    await store.fetch(account, async () => ({ ...data, contacts: [] }));
    expect(localStorage.getItem(CONTACTS_STORAGE_KEY)).toBe(original);
    expect(store.snapshot().issue).toMatch(/Nie można zapisać/);
  });

  it.each([true, false])('invalidates in-flight responses on clear(removeStored=%s)', async (removeStored) => {
    const store = createContactsStore();
    store.activate(account);
    await store.fetch(account, async () => data);
    const original = localStorage.getItem(CONTACTS_STORAGE_KEY);
    let resolve!: (value: unknown) => void;
    const pending = store.fetch(
      account,
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    store.clear(removeStored);
    resolve(data);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(store.snapshot().saved).toBeUndefined();
    expect(localStorage.getItem(CONTACTS_STORAGE_KEY)).toBe(removeStored ? null : original);
  });

  it('isolates both users and families, including delayed responses', async () => {
    const store = createContactsStore();
    store.activate(account);
    await store.fetch(account, async () => data);
    let resolve!: (value: unknown) => void;
    const pending = store.fetch(
      account,
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    store.activate(`${id(1)}:${id(9)}`);
    expect(store.snapshot().saved).toBeUndefined();
    resolve(data);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    store.activate(`${id(9)}:${id(2)}`);
    expect(store.snapshot().saved).toBeUndefined();
    await expect(store.fetch(`${id(9)}:${id(2)}`, async () => data)).rejects.toThrow();
  });

  it('reloads another tab snapshot and rejects responses started before its update', async () => {
    const store = createContactsStore();
    const other = createContactsStore();
    store.activate(account);
    other.activate(account);
    let resolve!: (value: unknown) => void;
    const pending = store.fetch(
      account,
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await other.fetch(account, async () => data);
    const saved = localStorage.getItem(CONTACTS_STORAGE_KEY);
    store.reload();
    expect(store.snapshot().saved?.data).toEqual(data);
    resolve({ ...data, contacts: [] });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(localStorage.getItem(CONTACTS_STORAGE_KEY)).toBe(saved);
    localStorage.removeItem(CONTACTS_STORAGE_KEY);
    store.reload();
    expect(store.snapshot().saved).toBeUndefined();
  });

  it('keeps the latest request when responses arrive out of order', async () => {
    const store = createContactsStore();
    store.activate(account);
    let resolve!: (value: unknown) => void;
    const pending = store.fetch(
      account,
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await store.fetch(account, async () => ({ ...data, contacts: [] }));
    resolve(data);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(store.snapshot().saved?.data.contacts).toEqual([]);
  });
});
