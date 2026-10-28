import { onlineManager, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import type { ShoppingItem, ShoppingList } from '@rodzina/shared';
import { useMe } from '../../sessionContext.js';
import { useOfflineSyncStatus } from '../../offline/status.js';
import { SYNC_INTERVAL_MS } from '../../queryClient.js';
import { listShoppingItems, listShoppingLists, type ShoppingChange } from './shoppingApi.js';
import { enqueueShopping, discardShoppingReview } from './shoppingOffline.js';
import type { StoredShoppingOperation } from './shoppingStorage.js';
import { applyShoppingChange, shoppingKey } from './shoppingOptimistic.js';

export function useShopping(selected: string | null) {
  const { user, family } = useMe();
  const client = useQueryClient();
  const account = { familyId: family!.id, userId: user!.id };
  const key = shoppingKey(account);
  const online = useSyncExternalStore(onlineManager.subscribe, () => onlineManager.isOnline());
  const status = useOfflineSyncStatus(`${account.familyId}:${account.userId}`, 'shopping');
  const mealsStatus = useOfflineSyncStatus(`${account.familyId}:${account.userId}`, 'meals');
  const syncing = status.syncing || mealsStatus.syncing;
  const operationsQuery = useQuery<StoredShoppingOperation[]>({
    queryKey: [...key, 'operations'],
    queryFn: () => client.getQueryData<StoredShoppingOperation[]>([...key, 'operations']) ?? [],
    enabled: false,
  });
  const changes = operationsQuery.data ?? [];
  const refresh = {
    refetchInterval: () => (syncing ? (false as const) : SYNC_INTERVAL_MS),
    refetchOnWindowFocus: () => (syncing ? false : ('always' as const)),
    refetchOnReconnect: () => (syncing ? false : ('always' as const)),
  };
  const lists = useQuery({
    queryKey: [...key, 'lists'],
    queryFn: ({ signal }) => listShoppingLists(signal),
    enabled: !syncing,
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
  for (const entry of changes.filter((op) => !op.review))
    applyShoppingChange(optimistic, account, entry.change, entry.submittedAt);
  const visibleLists = projected.get(JSON.stringify([...key, 'lists'])) as ShoppingList[] | undefined;
  const active = visibleLists?.find((list) => list.id === selected) ?? visibleLists?.[0];
  const listId = active?.id;
  const items = useQuery({
    queryKey: [...key, 'items', listId],
    queryFn: ({ signal }) => listShoppingItems(listId!, signal),
    enabled:
      !syncing && !!listId && !changes.some(({ change }) => change.type === 'createList' && change.id === listId),
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
      await enqueueShopping(client, account, change);
    },
    active,
    online,
    syncedAt: items.dataUpdatedAt || lists.dataUpdatedAt || undefined,
    pendingCount: changes.filter((op) => !op.review).length,
    syncError: status.reviewCount
      ? (status.lastError ?? 'Zapisane zmiany zakupów wymagają sprawdzenia. Zachowano je na urządzeniu.')
      : status.storageIssue,
    reviewCount: status.reviewCount,
    discardReview: () => discardShoppingReview(client, account),
  };
}
