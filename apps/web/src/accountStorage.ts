import type { QueryClient } from '@tanstack/react-query';
import { accountToken, isAccountCurrent } from './offline/database.js';
import { reportStorageIssue, storageError } from './offline/status.js';
import type { AuthUser, Family } from '@rodzina/shared';
type ClearReason = 'logout' | 'session-lost' | 'account-changed' | 'storage-changed';
type ClearOptions = { removeStored: boolean; queryClient: QueryClient | undefined };
type AccountStore = {
  activate?: (account: string) => void | Promise<void>;
  restore?: (client: QueryClient, session: { user: AuthUser; family: Family }) => void | Promise<void>;
  stop?: (client: QueryClient | undefined) => void;
  name: string;
  // Invalidate in-memory store generations before invalidating the session and alarms.
  phase?: 'before-invalidation';
  clear: (options: ClearOptions) => void | Promise<void>;
};
const stores = new Map<string, AccountStore>();

export function registerAccountStore(store: AccountStore) {
  if (stores.has(store.name)) throw new Error(`Account store already registered: ${store.name}`);
  stores.set(store.name, store);
  return () => stores.delete(store.name);
}
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
    if (isAccountCurrent(token)) queryClient?.clear();
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected' && isAccountCurrent(token)) {
      reportStorageIssue(`Nie można usunąć wszystkich danych konta. ${storageError(failure.reason)}`);
      throw failure.reason;
    }
  });
}

export async function restoreAccountStores(
  session: { user: AuthUser; family: Family },
  client: QueryClient | undefined,
  current: () => boolean,
) {
  const account = session.family.id + ':' + session.user.id;
  for (const store of stores.values()) {
    if (!current()) return;
    await store.activate?.(account);
    if (!current()) return;
    if (client) await store.restore?.(client, session);
  }
}
export function stopAccountPersistence(client: QueryClient | undefined) {
  for (const store of stores.values()) store.stop?.(client);
}
