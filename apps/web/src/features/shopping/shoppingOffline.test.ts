import '../../offline/testSetup.js';
import { onlineManager, QueryClient } from '@tanstack/react-query';
import { IDBObjectStore } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OFFLINE_REPLAY_MAX_AGE_MS, type ShoppingItem, type ShoppingList } from '@rodzina/shared';
import { enqueueShopping, restoreShopping, stopShoppingPersistence, type ShoppingSession } from './shoppingOffline.js';
import { readShoppingData, updateShoppingData, notifyShopping } from './shoppingStorage.js';
import { readOperations } from '../../offline/outbox.js';
import { shoppingKey } from './shoppingOptimistic.js';
import { clearDatabase, closeDatabase, transact } from '../../offline/database.js';

const session = {
  user: { id: 'user', familyId: 'family', displayName: 'Ania' },
  family: { id: 'family' },
} as ShoppingSession;
const account = { familyId: 'family', userId: 'user' };
const key = shoppingKey(account);
const list = {
  id: 'list',
  familyId: 'family',
  name: 'Zakupy',
  position: 0,
  createdBy: 'user',
  createdAt: 1,
  updatedAt: 1,
} as ShoppingList;
const item = {
  id: 'milk',
  listId: 'list',
  name: 'Mleko',
  quantity: null,
  category: 'dairy',
  position: 0,
  isChecked: false,
  checkedBy: null,
  checkedAt: null,
  createdBy: 'user',
  createdAt: 1,
  updatedAt: 1,
} as ShoppingItem;
const clients: QueryClient[] = [];
async function start(seed = false) {
  const client = new QueryClient();
  clients.push(client);
  client.mount();
  await restoreShopping(client, session);
  if (seed) {
    client.setQueryData([...key, 'lists'], [list]);
    client.setQueryData([...key, 'items', 'list'], [item]);
  }
  return client;
}
const data = () => readShoppingData('family:user');
const edit = { type: 'edit' as const, id: 'milk', listId: 'list', data: { isChecked: true } };
const api = (write?: (path: string) => Promise<unknown>) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (path !== '/api/auth/me') await write?.(path);
      return { ok: true, text: async () => JSON.stringify(path === '/api/auth/me' ? session : {}) };
    }),
  );
afterEach(() => {
  for (const client of clients.splice(0)) {
    stopShoppingPersistence(client);
    client.unmount();
    client.clear();
  }
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('shopping adapter for the shared outbox', () => {
  it('keeps an observed range that is not yet persisted while refreshing queue state', async () => {
    onlineManager.setOnline(false);
    const client = await start(true);
    const range = client
      .getQueryCache()
      .build(client, { queryKey: [...key, 'items', 'loading'], queryFn: () => new Promise(() => {}) });
    notifyShopping();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(client.getQueryCache().find({ queryKey: [...key, 'items', 'loading'], exact: true })).toBe(range);
  });
  it.each([403, 404])(
    'interprets shopping %s without restoring a missing item or hiding readable family data',
    async (status) => {
      onlineManager.setOnline(false);
      const client = await start(true);
      await enqueueShopping(client, account, edit);
      vi.stubGlobal(
        'fetch',
        vi.fn(async (path: string) =>
          path === '/api/auth/me'
            ? { ok: true, status: 200, text: async () => JSON.stringify(session) }
            : {
                ok: false,
                status,
                text: async () =>
                  JSON.stringify({
                    error: { code: status === 403 ? 'FORBIDDEN' : 'NOT_FOUND', message: 'Nie można zapisać zmiany.' },
                  }),
              },
        ),
      );
      onlineManager.setOnline(true);
      await vi.waitFor(async () => expect((await data())?.operations[0]?.review).toBe('rejected'));
      await vi.waitFor(() =>
        expect(client.getQueryData([...key, 'items', 'list'])).toEqual(status === 403 ? [item] : []),
      );
      expect(client.getQueryData([...key, 'lists'])).toEqual([list]);
    },
  );
  it('commits before acknowledging, persists only shopping and restores a killed process', async () => {
    onlineManager.setOnline(false);
    const first = await start(true);
    first.setQueryData(['events'], ['private calendar']);
    await enqueueShopping(first, account, edit);
    await enqueueShopping(first, account, { type: 'add', id: 'bread', listId: 'list', data: { name: 'Chleb' } });
    const saved = await data();
    expect(saved?.operations).toHaveLength(2);
    expect(saved?.operations.map((op) => op.sequence)).toEqual([1, 2]);
    expect(JSON.stringify(saved)).not.toContain('private calendar');
    expect(Object.keys(localStorage).some((key) => key.startsWith('rodzina:shopping'))).toBe(false);
    stopShoppingPersistence(first);
    first.clear();
    await closeDatabase();
    const restored = await start();
    expect(restored.getQueryData([...key, 'items', 'list'])).toEqual([item]);
    expect(restored.getMutationCache().getAll()).toHaveLength(0);
    expect(restored.getQueryData([...key, 'operations'])).toHaveLength(2);
    expect((await data())?.operations).toEqual(saved?.operations);
  });
  it('refuses a full store without rendering or sending an uncommitted operation', async () => {
    const client = await start(true);
    await enqueueShopping(client, account, edit);
    api();
    await vi.waitFor(async () => expect((await data())?.operations).toHaveLength(0));
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<typeof put>
    ) {
      if (this.name === 'cache') throw new DOMException('Full', 'QuotaExceededError');
      return put.apply(this, args);
    });
    const before = client.getMutationCache().getAll().length;
    await expect(
      enqueueShopping(client, account, { type: 'add', id: 'bread', listId: 'list', data: { name: 'Chleb' } }),
    ).rejects.toThrow();
    expect(client.getMutationCache().getAll()).toHaveLength(before);
    expect((await data())?.operations).toHaveLength(0);
  });
  it('merges journals from two clients and sends each operation once in committed order', async () => {
    onlineManager.setOnline(false);
    const a = await start(true);
    const b = await start();
    await Promise.all([
      enqueueShopping(a, account, edit),
      enqueueShopping(b, account, { type: 'add', id: 'bread', listId: 'list', data: { name: 'Chleb' } }),
    ]);
    expect((await data())?.operations).toHaveLength(2);
    const writes: string[] = [];
    api(async (path) => {
      writes.push(path);
    });
    onlineManager.setOnline(true);
    await vi.waitFor(async () => expect((await data())?.operations).toHaveLength(0));
    expect(writes).toHaveLength(2);
    expect(new Set(writes).size).toBe(2);
  });
  it('retains in-flight intent and retries a lost response with the original ID', async () => {
    const first = await start(true);
    let sent = false;
    api(async () => {
      sent = true;
      await new Promise(() => {});
    });
    await enqueueShopping(first, account, { type: 'add', id: 'stable-id', listId: 'list', data: { name: 'Chleb' } });
    await vi.waitFor(() => expect(sent).toBe(true));
    const saved = (await data())!.operations[0]!;
    stopShoppingPersistence(first);
    first.clear();
    const writes: string[] = [];
    api(async (path) => {
      writes.push(path);
    });
    await start();
    await vi.waitFor(async () => expect((await data())?.operations).toHaveLength(0));
    expect(writes).toEqual(['/api/shopping/lists/list/items?operationId=stable-id&actorId=user']);
    expect(saved.operationId).toBe('stable-id');
  });

  it('lets the surviving tab drain earlier work before its own newly accepted operation', async () => {
    onlineManager.setOnline(false);
    const first = await start(true);
    const second = await start();
    await enqueueShopping(first, account, edit);
    await enqueueShopping(second, account, { type: 'add', id: 'bread', listId: 'list', data: { name: 'Chleb' } });
    stopShoppingPersistence(first);
    first.clear();
    const writes: string[] = [];
    api(async (path) => {
      writes.push(path);
    });
    onlineManager.setOnline(true);
    await vi.waitFor(async () => expect((await data())?.operations).toHaveLength(0));
    expect(writes.map((path) => path.split('?')[0])).toEqual([
      '/api/shopping/items/milk',
      '/api/shopping/lists/list/items',
    ]);
  });
  it('retains an expired operation as review even after correcting the device clock', async () => {
    onlineManager.setOnline(false);
    const first = await start(true);
    await enqueueShopping(first, account, edit);
    stopShoppingPersistence(first);
    first.clear();
    await transact('readwrite', async (tx) => {
      const operations = await readOperations(tx, 'family:user');
      for (const op of operations)
        tx.objectStore('outbox').put({ ...op, submittedAt: Date.now() - OFFLINE_REPLAY_MAX_AGE_MS - 1000 });
    });
    api();
    onlineManager.setOnline(true);
    const restored = await start();
    await vi.waitFor(async () => expect((await data())?.operations[0]?.review).toBe('expired'));
    expect(fetch).not.toHaveBeenCalled();
    stopShoppingPersistence(restored);
    restored.clear();
    vi.spyOn(Date, 'now').mockReturnValue(1);
    await start();
    expect((await data())?.operations[0]?.review).toBe('expired');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not rebuild the previous account after logout during a request', async () => {
    const client = await start(true);
    let finish!: () => void;
    api(
      async () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await enqueueShopping(client, account, edit);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    stopShoppingPersistence(client);
    client.clear();
    await clearDatabase();
    finish();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await readShoppingData()).toBeUndefined();
    expect(client.getQueryData([...key, 'lists'])).toBeUndefined();
  });
  it('enforces the pinned queue budget without trimming an existing intent', async () => {
    onlineManager.setOnline(false);
    const client = await start(true);
    await enqueueShopping(client, account, edit);
    const saved = await data();
    await expect(
      updateShoppingData('family:user', (old) => ({
        ...old!,
        session: { ...session, family: { ...session.family, name: 'x'.repeat(4 * 1048576) } },
      })),
    ).rejects.toThrow('budżet');
    expect((await data())?.operations).toEqual(saved?.operations);
  });
});
