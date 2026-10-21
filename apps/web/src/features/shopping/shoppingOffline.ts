import { dehydrate, hydrate, onlineManager, type QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import type { PersistedClient } from '@tanstack/query-persist-client-core';
import type { ShoppingItem, ShoppingList } from '@rodzina/shared';
import type { AuthUser, Family } from '@rodzina/shared';

import { apiFetch, ApiRequestError } from '../../api.js';
import { changeShopping, type ShoppingChange } from './shoppingApi.js';
import { applyShoppingChange, shoppingKey, type ShoppingAccount } from './shoppingOptimistic.js';

export const SHOPPING_STORAGE_KEY = 'rodzina:shopping:v1';
export const PENDING_LOGOUT_KEY = 'rodzina:pending-logout';
export type ShoppingSession = { user: AuthUser; family: Family };
export type QueuedShoppingChange = { change: ShoppingChange; operationId: string; submittedAt: number };
type Snapshot = PersistedClient & { session: ShoppingSession };
type Runtime = { stop: () => void; flush: () => void; account: string };
const runtimes = new WeakMap<QueryClient, Runtime>();
const storageError = () =>
  new Error(
    'Nie można zapisać zakupów na urządzeniu. Zwolnij miejsce lub włącz pamięć przeglądarki i spróbuj ponownie.',
  );
const accountId = (session: ShoppingSession) => `${session.family.id}:${session.user.id}`;
const journalPrefix = `${SHOPPING_STORAGE_KEY}:operation:`;

export function readShoppingSession(): ShoppingSession | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(SHOPPING_STORAGE_KEY) ?? 'null') as Snapshot | null;
    if (value?.session.user.id && value.session.family.id && value.buster === accountId(value.session))
      return value.session;
  } catch {
    /* No usable local account. */
  }
}

export function clearShoppingStorage(client?: QueryClient) {
  if (client) stopShoppingPersistence(client);
  try {
    localStorage.removeItem(SHOPPING_STORAGE_KEY);
    for (const name of Object.keys(localStorage)) if (name.startsWith(journalPrefix)) localStorage.removeItem(name);
  } catch {
    /* Storage may be disabled. */
  }
}

export function stopShoppingPersistence(client: QueryClient) {
  runtimes.get(client)?.stop();
  runtimes.delete(client);
}

export function configureShoppingMutations(client: QueryClient, account: ShoppingAccount) {
  const key = shoppingKey(account);
  const identity = `${account.familyId}:${account.userId}`;
  client.setQueryDefaults(key, { gcTime: Infinity });
  client.setMutationDefaults(key, {
    scope: { id: identity },
    gcTime: 300_000,
    networkMode: 'offlineFirst',
    retry: (_count, error) =>
      error instanceof ApiRequestError ? error.status >= 500 || error.status === 429 : error.name !== 'AbortError',
    retryDelay: 3000,
    onMutate: async () => {
      await client.cancelQueries({ queryKey: key });
      runtimes.get(client)?.flush();
    },
    mutationFn: async ({ change, operationId }: QueuedShoppingChange) => {
      if (!client.getQueryState([...key, 'lists'])) throw new DOMException('Session changed', 'AbortError');
      const runtime = runtimes.get(client);
      if (runtime && runtime.account !== identity) throw new DOMException('Session changed', 'AbortError');
      if (!onlineManager.isOnline()) throw new TypeError('Offline');
      // A browser cookie may have changed in another tab while this queue was offline.
      if (runtime) {
        const current = await apiFetch<ShoppingSession>('/api/auth/me');
        if (runtimes.get(client) !== runtime) throw new DOMException('Session changed', 'AbortError');
        if (accountId(current) !== identity) {
          window.dispatchEvent(new Event('rodzina:session-lost'));
          throw new DOMException('Session changed', 'AbortError');
        }
      }
      return changeShopping(change, operationId, runtime ? account.userId : undefined);
    },
    onSuccess: (response, variables) => {
      if (runtimes.get(client)?.account !== identity && runtimes.has(client)) return;
      // Logging out clears the query too; late responses cannot rebuild it.
      if (!client.getQueryState([...key, 'lists'])) return;
      const { change, submittedAt } = variables as QueuedShoppingChange;
      applyShoppingChange(client, account, change, submittedAt);
      const result = response as { item?: ShoppingItem; list?: ShoppingList };
      if (result.item)
        client.setQueryData<ShoppingItem[]>([...key, 'items', result.item.listId], (old = []) =>
          old.map((item) => (item.id === result.item!.id ? result.item! : item)),
        );
      if (result.list)
        client.setQueryData<ShoppingList[]>([...key, 'lists'], (old = []) =>
          old.map((list) => (list.id === result.list!.id ? result.list! : list)),
        );
    },
    onSettled: () => {
      if (client.isMutating({ mutationKey: key }) <= 1) void client.invalidateQueries({ queryKey: key });
    },
  });
}

export function restoreShopping(client: QueryClient, session: ShoppingSession) {
  const identity = accountId(session);
  if (runtimes.get(client)?.account === identity) return;
  if (runtimes.has(client)) {
    clearShoppingStorage(client);
    client.clear();
  }
  const account = { familyId: session.family.id, userId: session.user.id };
  const key = shoppingKey(account);
  configureShoppingMutations(client, account);
  let active = true;
  const storage: Storage = {
    length: 0,
    key: (index) => localStorage.key(index),
    clear: () => {},
    getItem: (name) => localStorage.getItem(name),
    removeItem: (name) => localStorage.removeItem(name),
    setItem: (name, value) => {
      if (active) localStorage.setItem(name, value);
    },
  };
  const persister = createSyncStoragePersister({ storage, key: SHOPPING_STORAGE_KEY, throttleTime: 0 });
  const operationKey = (id: string) => `${journalPrefix}${identity}:${id}`;
  let saved: Snapshot | undefined;
  try {
    saved = persister.restoreClient() as Snapshot | undefined;
  } catch {
    try {
      persister.removeClient();
    } catch {
      /* Storage may be disabled. */
    }
  }
  if (
    saved?.buster === identity &&
    Array.isArray(saved.clientState?.mutations) &&
    Array.isArray(saved.clientState.queries)
  ) {
    try {
      const matches = (candidate: readonly unknown[] | undefined) =>
        key.every((part, index) => candidate?.[index] === part);
      // Individual journal entries cannot overwrite another tab's offline queue.
      // The snapshot is a cache; the journal is authoritative for pending work.
      saved.clientState.mutations = Object.keys(localStorage)
        .filter((name) => name.startsWith(`${journalPrefix}${identity}:`))
        .flatMap((name) => {
          try {
            return [JSON.parse(localStorage.getItem(name)!) as (typeof saved.clientState.mutations)[number]];
          } catch {
            return [];
          }
        })
        .filter((mutation) => matches(mutation.mutationKey));
      saved.clientState.queries = saved.clientState.queries.filter((query) => matches(query.queryKey));
      saved.clientState.mutations.forEach((mutation) => {
        mutation.state.isPaused = true;
      });
      hydrate(client, saved.clientState);
    } catch {
      client.removeQueries({ queryKey: key });
      client
        .getMutationCache()
        .findAll({ mutationKey: key })
        .forEach((mutation) => client.getMutationCache().remove(mutation));
    }
  } else {
    try {
      persister.removeClient();
    } catch {
      /* Report failure when editing. */
    }
  }
  const snapshot = (): Snapshot => ({
    timestamp: Date.now(),
    buster: identity,
    session: { user: { ...session.user, email: null }, family: { ...session.family, joinCode: '' } },
    clientState: dehydrate(client, {
      shouldDehydrateQuery: (query) =>
        key.every((part, index) => query.queryKey[index] === part) && query.state.data !== undefined,
      shouldDehydrateMutation: (mutation) =>
        key.every((part, index) => mutation.options.mutationKey?.[index] === part) &&
        mutation.state.status === 'pending',
    }),
  });
  const save = () => {
    if (active) persister.persistClient(snapshot());
  };
  const flush = () => {
    try {
      const value = snapshot();
      storage.setItem(SHOPPING_STORAGE_KEY, JSON.stringify(value));
      for (const mutation of value.clientState.mutations) {
        const { operationId } = mutation.state.variables as QueuedShoppingChange;
        storage.setItem(operationKey(operationId), JSON.stringify(mutation));
      }
    } catch {
      throw storageError();
    }
  };
  const unsubQuery = client.getQueryCache().subscribe(save);
  const unsubMutation = client.getMutationCache().subscribe((event) => {
    save();
    if (
      event.type === 'updated' &&
      ['success', 'error'].includes(event.mutation.state.status) &&
      key.every((part, index) => event.mutation.options.mutationKey?.[index] === part)
    ) {
      try {
        // Commit the confirmed cache before discarding its durable operation.
        flush();
        const { operationId } = event.mutation.state.variables as QueuedShoppingChange;
        storage.removeItem(operationKey(operationId));
      } catch {
        /* Keep the journal entry for safe replay on the next start. */
      }
    }
  });
  runtimes.set(client, {
    account: identity,
    stop: () => {
      active = false;
      unsubQuery();
      unsubMutation();
    },
    // The persister batches background saves. Before accepting a change, write
    // synchronously so killing the process cannot lose an acknowledged action.
    flush,
  });
  save();
  // This also resumes mutations persisted while a request was in flight.
  void client.resumePausedMutations();
}

export function enqueueShopping(client: QueryClient, account: ShoppingAccount, change: ShoppingChange) {
  const mutation = client.getMutationCache().build(client, { mutationKey: shoppingKey(account) });
  const completion = mutation.execute({
    change,
    operationId: change.type === 'add' || change.type === 'createList' ? change.id : crypto.randomUUID(),
    submittedAt: Date.now(),
  } satisfies QueuedShoppingChange);
  void completion.catch(() => {});
  runtimes.get(client)?.flush();
  return completion;
}
