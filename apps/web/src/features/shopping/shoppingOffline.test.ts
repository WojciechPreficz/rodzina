import { onlineManager, QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShoppingItem, ShoppingList } from '@rodzina/shared';
import {
  clearShoppingStorage,
  enqueueShopping,
  restoreShopping,
  readShoppingSession,
  SHOPPING_STORAGE_KEY,
  stopShoppingPersistence,
  type ShoppingSession,
} from './shoppingOffline.js';
import { shoppingKey } from './shoppingOptimistic.js';

const session = {
  user: { id: 'user', familyId: 'family', displayName: 'Ania' },
  family: { id: 'family' },
} as ShoppingSession;
const account = { familyId: 'family', userId: 'user' };
const key = shoppingKey(account);
const list = { id: 'list', familyId: 'family', name: 'Zakupy' } as ShoppingList;
const item = { id: 'milk', listId: 'list', name: 'Mleko', isChecked: false } as ShoppingItem;
const clients: QueryClient[] = [];
function start() {
  const client = new QueryClient();
  clients.push(client);
  client.mount();
  restoreShopping(client, session);
  client.setMutationDefaults(key, { ...client.getMutationDefaults(key), retryDelay: 0 });
  return client;
}
function seed(client: QueryClient) {
  client.setQueryData([...key, 'lists'], [list]);
  client.setQueryData([...key, 'items', 'list'], [item]);
}
afterEach(() => {
  for (const client of clients.splice(0)) {
    stopShoppingPersistence(client);
    client.unmount();
    client.clear();
  }
  localStorage.clear();
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
});

describe('durable shopping queue', () => {
  it('keeps independent tabs from overwriting each other pending changes', () => {
    onlineManager.setOnline(false);
    const first = start();
    seed(first);
    void enqueueShopping(first, account, { type: 'edit', id: 'milk', listId: 'list', data: { isChecked: true } });
    const second = start();
    void enqueueShopping(second, account, { type: 'add', id: 'bread', listId: 'list', data: { name: 'Chleb' } });
    void enqueueShopping(first, account, { type: 'add', id: 'eggs', listId: 'list', data: { name: 'Jajka' } });
    stopShoppingPersistence(first);
    stopShoppingPersistence(second);
    first.clear();
    second.clear();
    const restored = start();
    expect(restored.getMutationCache().getAll()).toHaveLength(3);
  });

  it('stores only shopping, restores a killed process and resumes all changes in order', async () => {
    onlineManager.setOnline(false);
    const first = start();
    seed(first);
    first.setQueryData(['events'], ['private calendar']);
    void enqueueShopping(first, account, { type: 'edit', id: 'milk', listId: 'list', data: { isChecked: true } });
    void enqueueShopping(first, account, { type: 'add', id: 'new', listId: 'list', data: { name: 'Chleb' } });
    void enqueueShopping(first, account, { type: 'edit', id: 'new', listId: 'list', data: { isChecked: true } });
    const saved = localStorage.getItem(SHOPPING_STORAGE_KEY)!;
    expect(JSON.parse(saved).clientState.mutations).toHaveLength(3);
    expect(saved).not.toContain('private calendar');
    stopShoppingPersistence(first);
    first.clear();
    const restored = start();
    expect(restored.getQueryData([...key, 'items', 'list'])).toEqual([item]);
    expect(restored.getMutationCache().getAll()).toHaveLength(3);
    const writes: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        if (path !== '/api/auth/me') writes.push(path);
        return { ok: true, text: async () => JSON.stringify(path === '/api/auth/me' ? session : {}) };
      }),
    );
    onlineManager.setOnline(true);
    await restored.resumePausedMutations();
    await vi.waitFor(() => expect(restored.isMutating()).toBe(0));
    expect(writes.map((path) => path.split('?')[0])).toEqual([
      '/api/shopping/items/milk',
      '/api/shopping/lists/list/items',
      '/api/shopping/items/new',
    ]);
    expect(restored.getQueryData<ShoppingItem[]>([...key, 'items', 'list'])?.map(({ isChecked }) => isChecked)).toEqual(
      [true, true],
    );
  });

  it('persists in-flight requests too and retries with the same operation ID', async () => {
    const client = start();
    seed(client);
    let began = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        if (path === '/api/auth/me') return { ok: true, text: async () => JSON.stringify(session) };
        began = true;
        return new Promise(() => {});
      }),
    );
    void enqueueShopping(client, account, { type: 'add', id: 'stable-id', listId: 'list', data: { name: 'Chleb' } });
    await vi.waitFor(() => expect(began).toBe(true));
    const saved = JSON.parse(localStorage.getItem(SHOPPING_STORAGE_KEY)!);
    expect(saved.clientState.mutations[0].state.isPaused).toBe(false);
    stopShoppingPersistence(client);
    client.clear();
    const writes: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        if (path !== '/api/auth/me') writes.push(path);
        return { ok: true, text: async () => JSON.stringify(path === '/api/auth/me' ? session : {}) };
      }),
    );
    const restored = start();
    await vi.waitFor(() => expect(restored.isMutating()).toBe(0));
    expect(writes).toEqual(['/api/shopping/lists/list/items?operationId=stable-id&actorId=user']);
  });

  it('clears disk on logout and never sends the previous account queue as another user', async () => {
    onlineManager.setOnline(false);
    const client = start();
    seed(client);
    void enqueueShopping(client, account, { type: 'remove', id: 'milk', listId: 'list' });
    expect(readShoppingSession()?.user.id).toBe('user');
    clearShoppingStorage(client);
    client.clear();
    expect(readShoppingSession()).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn());
    onlineManager.setOnline(true);
    await client.resumePausedMutations();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('checks the live session before replaying a restored queue', async () => {
    onlineManager.setOnline(false);
    const client = start();
    seed(client);
    void enqueueShopping(client, account, { type: 'remove', id: 'milk', listId: 'list' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () => JSON.stringify({ ...session, user: { ...session.user, id: 'other' } }),
      })),
    );
    onlineManager.setOnline(true);
    await vi.waitFor(() => expect(client.isMutating()).toBe(0));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/auth/me', expect.anything());
  });

  it('refuses to send or acknowledge a mutation when durable storage is full', async () => {
    const client = start();
    seed(client);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    vi.stubGlobal('fetch', vi.fn());
    expect(() => enqueueShopping(client, account, { type: 'remove', id: 'milk', listId: 'list' })).toThrow(
      'Nie można zapisać',
    );
    await vi.waitFor(() => expect(client.isMutating()).toBe(0));
    expect(fetch).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
