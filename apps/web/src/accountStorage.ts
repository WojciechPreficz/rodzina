import type { QueryClient } from '@tanstack/react-query';
import { calendarStore } from './features/calendar/calendarOffline.js';
import { taskStore } from './features/tasks/taskOffline.js';
import { clearShoppingStorage, stopShoppingPersistence } from './features/shopping/shoppingOffline.js';
import { forgetOfflineData } from './offlineData.js';
import { clearDatabase, accountToken, isAccountCurrent } from './offline/database.js';
import { reportStorageIssue, storageError } from './offline/status.js';
import { contactsStore } from './features/contacts/contactsOffline.js';

type ClearReason = 'logout' | 'session-lost' | 'account-changed' | 'storage-changed';
type ClearOptions = { removeStored: boolean; queryClient: QueryClient | undefined };
type AccountStore = {
  name: string;
  // Invalidate in-memory store generations before invalidating the session and alarms.
  phase?: 'before-invalidation';
  clear: (options: ClearOptions) => void | Promise<void>;
};
const stores = new Map<string, AccountStore>();

registerAccountStore({
  name: 'contacts',
  phase: 'before-invalidation',
  clear: () => contactsStore.clear(false),
});

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
  clear: () => taskStore.clear(false),
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
  phase: 'before-invalidation',
  clear: () => {
    forgetOfflineData();
  },
});
registerAccountStore({
  name: 'indexed-db',
  phase: 'before-invalidation',
  clear: ({ removeStored }) => clearDatabase(removeStored),
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
): Promise<void> {
  // A storage event belongs to another tab: never delete its newly saved account.
  const options = { removeStored: reason !== 'storage-changed', queryClient };
  const clearing: Promise<void>[] = [];
  const clear = (store: AccountStore) => {
    try {
      clearing.push(Promise.resolve(store.clear(options)));
    } catch (error) {
      clearing.push(Promise.reject(error));
    }
  };
  for (const store of stores.values()) if (store.phase === 'before-invalidation') clear(store);
  invalidateSession?.();
  for (const store of stores.values()) if (store.phase !== 'before-invalidation') clear(store);
  // Logout cancels requests after stopping persistence and before clearing queries.
  if (beforeQueryClear) clearing.push(beforeQueryClear());
  else queryClient?.clear();
  const token = accountToken();
  return Promise.allSettled(clearing).then((results) => {
    queryClient?.clear();
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected' && isAccountCurrent(token)) {
      reportStorageIssue(`Nie można usunąć wszystkich danych konta. ${storageError(failure.reason)}`);
      throw failure.reason;
    }
  });
}
