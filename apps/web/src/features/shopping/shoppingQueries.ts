import { onlineManager, useMutationState, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import type { ShoppingItem, ShoppingList } from '@rodzina/shared';
import { useMe } from '../../auth.js';
import { SYNC_INTERVAL_MS } from '../../queryClient.js';
import { listShoppingItems, listShoppingLists, type ShoppingChange } from './shoppingApi.js';
import { enqueueShopping, type QueuedShoppingChange } from './shoppingOffline.js';
import { applyShoppingChange, shoppingKey } from './shoppingOptimistic.js';

export function useShopping(selected: string | null) {
  const { user, family } = useMe();
  const client = useQueryClient();
  const account = { familyId: family!.id, userId: user!.id };
  const key = shoppingKey(account);
  const online = useSyncExternalStore(onlineManager.subscribe, () => onlineManager.isOnline());
  const changes = useMutationState({
    filters: { mutationKey: key, status: 'pending' },
    select: (mutation) => mutation.state.variables as QueuedShoppingChange,
  });
  const failures = useMutationState({
    filters: { mutationKey: key, status: 'error' },
    select: (mutation) => mutation.state.error,
  });
  const refresh = {
    refetchInterval: () => (client.isMutating({ mutationKey: key }) ? (false as const) : SYNC_INTERVAL_MS),
    refetchOnWindowFocus: () => (client.isMutating({ mutationKey: key }) === 0 ? ('always' as const) : false),
    refetchOnReconnect: () => (client.isMutating({ mutationKey: key }) === 0 ? ('always' as const) : false),
  };
  const lists = useQuery({
    queryKey: [...key, 'lists'],
    queryFn: ({ signal }) => listShoppingLists(signal),
    ...refresh,
  });
  // Keep server data separate from pending changes: rejecting one write must
  // never roll back later offline edits, and refetches cannot overwrite them.
  const projected = new Map(
    client.getQueriesData({ queryKey: key }).map(([queryKey, data]) => [JSON.stringify(queryKey), data]),
  );
  const optimistic = {
    setQueryData: (queryKey: readonly unknown[], update: (old: unknown) => unknown) => {
      const hash = JSON.stringify(queryKey);
      const value = update(projected.get(hash));
      projected.set(hash, value);
      return value;
    },
  } as Pick<QueryClient, 'setQueryData'>;
  for (const entry of changes) applyShoppingChange(optimistic, account, entry.change, entry.submittedAt);
  const visibleLists = projected.get(JSON.stringify([...key, 'lists'])) as ShoppingList[] | undefined;
  const active = visibleLists?.find((list) => list.id === selected) ?? visibleLists?.[0];
  const listId = active?.id;
  const items = useQuery({
    queryKey: [...key, 'items', listId],
    queryFn: ({ signal }) => listShoppingItems(listId!, signal),
    enabled: !!listId && !changes.some(({ change }) => change.type === 'createList' && change.id === listId),
    ...refresh,
  });
  const visibleItems = (projected.get(JSON.stringify([...key, 'items', listId])) ??
    (changes.some(({ change }) => change.type === 'createList' && change.id === listId) ? [] : undefined)) as
    ShoppingItem[] | undefined;
  return {
    lists: { ...lists, data: visibleLists, isPending: !visibleLists && lists.isPending },
    items: { ...items, data: visibleItems ?? items.data, isPending: !visibleItems && items.isPending },
    // Acceptance is local. Network completion is reported separately and must
    // not block the next checkbox or leave a quick-add dialog open offline.
    queueChange: async (change: ShoppingChange) => {
      void enqueueShopping(client, account, change).catch(() => {});
    },
    active,
    online,
    pendingCount: changes.length,
    syncError: failures.at(-1)?.message,
    dismissSyncError: () =>
      client
        .getMutationCache()
        .findAll({ mutationKey: key, status: 'error' })
        .forEach((mutation) => client.getMutationCache().remove(mutation)),
  };
}
