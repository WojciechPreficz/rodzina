import { onlineManager, QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, TaskList } from '@rodzina/shared';
import { clearAccountData, registerAccountStore } from './accountStorage.js';
import { calendarStore, CALENDAR_STORAGE_KEY } from './features/calendar/calendarOffline.js';
import { taskStore, TASK_STORAGE_KEY } from './features/tasks/taskOffline.js';
import {
  enqueueShopping,
  restoreShopping,
  SHOPPING_STORAGE_KEY,
  PENDING_LOGOUT_KEY,
} from './features/shopping/shoppingOffline.js';
import { accountId, OFFLINE_DATA_KEY, saveOfflineData } from './offlineData.js';

// Discover keys independently of the registry, including stores not yet registered.
// Dynamic journal keys are also exercised through the real module APIs below.
const sources = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
const eventNames = new Set(['rodzina:session-lost', 'rodzina:tasks-changed']);
const declaredKeys = new Set(
  Object.values(sources).flatMap((source) =>
    [...source.matchAll(/['"`](rodzina:[^'"`\r\n]+)['"`]/g)]
      .map((match) => match[1]!)
      .filter((key) => !key.includes('${') && !key.endsWith(':') && !eventNames.has(key)),
  ),
);
const logoutSurvivors = new Set([
  // This account-free marker prevents a stale HTTP cookie from restoring a logged-out
  // web session until the server has confirmed an offline logout.
  PENDING_LOGOUT_KEY,
]);
const user: AuthUser = {
  id: '10000000-0000-4000-8000-000000000001',
  familyId: '10000000-0000-4000-8000-000000000002',
  displayName: 'Ania',
  color: '#123456',
  role: 'admin',
  email: null,
  createdAt: 1,
  updatedAt: 1,
};
const session = {
  user,
  family: { id: user.familyId, name: 'Rodzina', timezone: 'Europe/Warsaw', joinCode: 'ABC123' },
};
const list: TaskList = {
  id: '10000000-0000-4000-8000-000000000003',
  familyId: user.familyId,
  ownerId: user.id,
  memberIds: [],
  name: 'Zadania',
  isDefault: true,
  position: 0,
  openTaskCount: 0,
  createdAt: 1,
  updatedAt: 1,
};
const clients: QueryClient[] = [];
const newClient = () => {
  const client = new QueryClient();
  clients.push(client);
  return client;
};

async function seedAccount(client: QueryClient) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => ({
      ok: true,
      text: async () =>
        JSON.stringify(
          path === '/api/auth/me' ? session : path === '/api/tasks/lists' ? { lists: [list] } : { tasks: [] },
        ),
    })),
  );
  calendarStore.activate(accountId(session));
  calendarStore.saveRange('2026-10', [], calendarStore.token());
  taskStore.activate(accountId(session));
  await taskStore.synchronize();
  taskStore.enqueue(list.id, crypto.randomUUID(), { type: 'create', data: { title: 'Farba' } });
  onlineManager.setOnline(false);
  restoreShopping(client, session);
  client.setQueryData(['shopping', user.familyId, user.id, 'lists'], []);
  void enqueueShopping(
    client,
    { familyId: user.familyId, userId: user.id },
    {
      type: 'createList',
      id: crypto.randomUUID(),
      name: 'Zakupy',
    },
  );
  saveOfflineData(session, [user], Date.now());
  client.setQueryData(['private'], 'cached account data');
}

afterEach(async () => {
  for (const queryClient of clients.splice(0)) await clearAccountData('logout', { queryClient });
  localStorage.clear();
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('account storage cleanup', () => {
  it.each(['logout', 'session-lost', 'account-changed'] as const)(
    'removes every declared account key and durable journal on %s',
    async (reason) => {
      const queryClient = newClient();
      await seedAccount(queryClient);
      expect([...declaredKeys]).toEqual(
        expect.arrayContaining([CALENDAR_STORAGE_KEY, TASK_STORAGE_KEY, SHOPPING_STORAGE_KEY, OFFLINE_DATA_KEY]),
      );
      expect(Object.keys(localStorage).filter((key) => key.includes(':operation:'))).toHaveLength(2);
      // Canary values make a newly declared storage key fail this test even before
      // its fixture has been added, unless its store participates in cleanup.
      for (const key of declaredKeys) if (localStorage.getItem(key) === null) localStorage.setItem(key, 'canary');
      localStorage.setItem(PENDING_LOGOUT_KEY, 'yes');
      localStorage.setItem('unrelated-app', 'keep');
      const token = calendarStore.token();

      await clearAccountData(reason, { queryClient });
      // Let any previously batched shopping persistence attempt to run as well.
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(
        Object.keys(localStorage).filter((key) => key.startsWith('rodzina:') && !logoutSurvivors.has(key)),
      ).toEqual([]);
      expect(localStorage.getItem(PENDING_LOGOUT_KEY)).toBe('yes');
      expect(localStorage.getItem('unrelated-app')).toBe('keep');
      expect(calendarStore.current(token)).toBe(false);
      expect(taskStore.getSnapshot()).toMatchObject({ account: '', items: {}, pending: [] });
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
      expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    },
  );

  it('preserves another tab storage while clearing this tab memory and persistence', async () => {
    const queryClient = newClient();
    await seedAccount(queryClient);
    const saved = { ...localStorage };

    clearAccountData('storage-changed', { queryClient });
    queryClient.setQueryData(['private'], 'late response');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect({ ...localStorage }).toEqual(saved);
    expect(taskStore.getSnapshot().account).toBe('');
    expect(calendarStore.snapshot().account).toBe('');
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });

  it('resets stores before session invalidation and clears queries after logout cancellation', async () => {
    const queryClient = newClient();
    await seedAccount(queryClient);
    let completeCancellation!: () => void;
    const cancellation = new Promise<void>((resolve) => {
      completeCancellation = resolve;
    });
    const invalidateSession = vi.fn(() => {
      expect(taskStore.getSnapshot().account).toBe('');
      expect(calendarStore.snapshot().account).toBe('');
      expect(localStorage.getItem(SHOPPING_STORAGE_KEY)).not.toBeNull();
    });
    const clearing = clearAccountData('logout', {
      queryClient,
      invalidateSession,
      beforeQueryClear: () => {
        expect(localStorage.getItem(SHOPPING_STORAGE_KEY)).toBeNull();
        expect(localStorage.getItem(OFFLINE_DATA_KEY)).toBeNull();
        return cancellation;
      },
    });
    expect(invalidateSession).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(['private'])).toBeDefined();
    completeCancellation();
    await clearing;
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('includes newly registered stores and passes the storage ownership option', () => {
    const clear = vi.fn();
    const unregister = registerAccountStore({ name: 'future-module', clear });
    try {
      clearAccountData('storage-changed');
      expect(clear).toHaveBeenLastCalledWith({ removeStored: false, queryClient: undefined });
      clearAccountData('logout');
      expect(clear).toHaveBeenLastCalledWith({ removeStored: true, queryClient: undefined });
      expect(() => registerAccountStore({ name: 'future-module', clear })).toThrow('already registered');
    } finally {
      unregister();
    }
  });
});
