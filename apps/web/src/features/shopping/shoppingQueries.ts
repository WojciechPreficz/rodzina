import { onlineManager, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { useMe } from '../../sessionContext.js';
import { useOfflineModule, useOfflineSyncStatus } from '../../offline/index.js';
import { SYNC_INTERVAL_MS } from '../../queryClient.js';
import { listShoppingItems, listShoppingLists, type ShoppingChange } from './shoppingApi.js';
import { shoppingStore } from './shoppingOffline.js';
import { shoppingKey } from './shoppingOptimistic.js';

export function useShopping(selected: string | null) {
  const { user, family } = useMe();
  const client = useQueryClient();
  const session = { user: user!, family: family! };
  const account = `${session.family.id}:${session.user.id}`;
  const key = shoppingKey({ familyId: session.family.id, userId: session.user.id });
  const online = useSyncExternalStore(onlineManager.subscribe, () => onlineManager.isOnline());
  const status = useOfflineSyncStatus(account, 'shopping');
  const mealsStatus = useOfflineSyncStatus(account, 'meals');
  const { saved, view, issue } = useOfflineModule(shoppingStore, account);
  const syncing = status.syncing || mealsStatus.syncing;
  const refresh = {
    refetchInterval: () => (syncing ? (false as const) : SYNC_INTERVAL_MS),
    refetchOnWindowFocus: () => (syncing ? false : ('always' as const)),
    refetchOnReconnect: () => (syncing ? false : ('always' as const)),
  };
  const listsKey = [...key, 'lists'];
  const lists = useQuery({
    queryKey: listsKey,
    queryFn: ({ signal }) => shoppingStore.fetchRange(session, listsKey, () => listShoppingLists(signal), signal),
    enabled: !syncing,
    ...refresh,
  });
  const visibleLists = view?.lists ?? (lists.data?.scope.current() ? lists.data.data : undefined);
  const active = visibleLists?.find((list) => list.id === selected) ?? visibleLists?.[0];
  const listId = active?.id;
  const itemsKey = [...key, 'items', listId ?? ''];
  const items = useQuery({
    queryKey: itemsKey,
    queryFn: ({ signal }) =>
      shoppingStore.fetchRange(session, itemsKey, () => listShoppingItems(listId!, signal), signal),
    enabled: !syncing && !!listId && !view?.localLists.has(listId),
    ...refresh,
  });
  const visibleItems = listId
    ? (view?.items(listId) ??
      (!saved?.revokedLists?.includes(listId) && items.data?.scope.current() ? items.data.data : undefined))
    : undefined;
  const syncedAt = (kind: string, id?: string) =>
    saved?.ranges.find((range) => range.kind === kind && (range.kind === 'lists' || range.listId === id))?.syncedAt;
  return {
    lists: { ...lists, data: visibleLists, isPending: !visibleLists && lists.isPending },
    items: { ...items, data: visibleItems, isPending: !visibleItems && items.isPending },
    queueChange: async (change: ShoppingChange) => {
      const scope = shoppingStore.accountScope();
      await client.cancelQueries({ queryKey: key });
      if (!scope.current()) throw new DOMException('Session changed', 'AbortError');
      await shoppingStore.enqueue(account, change);
    },
    active,
    online,
    syncedAt: syncedAt('items', listId) || syncedAt('lists') || undefined,
    pendingCount: view?.pendingCount ?? 0,
    syncError: status.reviewCount
      ? (status.lastError ?? 'Zapisane zmiany zakupów wymagają sprawdzenia. Zachowano je na urządzeniu.')
      : (issue ?? status.storageIssue),
    reviewCount: status.reviewCount,
    discardReview: async () => {
      await shoppingStore.discardReview(account);
      void client.invalidateQueries({ queryKey: key });
    },
  };
}
