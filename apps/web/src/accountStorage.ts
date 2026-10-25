import type { QueryClient } from '@tanstack/react-query';
import { calendarStore } from './features/calendar/calendarOffline.js';
import { taskStore } from './features/tasks/taskOffline.js';
import { clearShoppingStorage, stopShoppingPersistence } from './features/shopping/shoppingOffline.js';
import { clearOfflineData } from './offlineData.js';

type ClearReason = 'logout' | 'session-lost' | 'account-changed' | 'storage-changed';
type ClearOptions = { removeStored: boolean; queryClient: QueryClient | undefined };
type AccountStore = {
  name: string;
  // Invalidate in-memory store generations before invalidating the session and alarms.
  phase?: 'before-invalidation';
  clear: (options: ClearOptions) => void;
};
const stores = new Map<string, AccountStore>();

export function registerAccountStore(store: AccountStore) {
  if (stores.has(store.name)) throw new Error(`Account store already registered: ${store.name}`);
  stores.set(store.name, store);
  return () => stores.delete(store.name);
}

registerAccountStore({
  name: 'calendar',
  phase: 'before-invalidation',
  clear: ({ removeStored }) => calendarStore.clear(removeStored),
});
registerAccountStore({
  name: 'tasks',
  phase: 'before-invalidation',
  clear: ({ removeStored }) => taskStore.clear(removeStored),
});
registerAccountStore({
  name: 'shopping',
  clear: ({ removeStored, queryClient }) => {
    if (removeStored) clearShoppingStorage(queryClient);
    else if (queryClient) stopShoppingPersistence(queryClient);
  },
});
registerAccountStore({
  name: 'offline-data',
  clear: ({ removeStored }) => {
    if (removeStored) clearOfflineData();
  },
});

export function clearAccountData(
  reason: ClearReason,
  {
    queryClient,
    invalidateSession,
    beforeQueryClear,
  }: {
    queryClient?: QueryClient | undefined;
    invalidateSession?: () => void;
    beforeQueryClear?: () => Promise<void>;
  } = {},
): void | Promise<void> {
  // A storage event belongs to another tab: never delete its newly saved account.
  const options = { removeStored: reason !== 'storage-changed', queryClient };
  for (const store of stores.values()) if (store.phase === 'before-invalidation') store.clear(options);
  invalidateSession?.();
  for (const store of stores.values()) if (store.phase !== 'before-invalidation') store.clear(options);
  // Logout cancels requests after stopping persistence and before clearing queries.
  if (beforeQueryClear) return beforeQueryClear().finally(() => queryClient?.clear());
  queryClient?.clear();
}
