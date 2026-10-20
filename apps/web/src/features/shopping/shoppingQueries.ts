import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ShoppingItem, ShoppingList } from '@rodzina/shared';
import { useMe } from '../../auth.js';
import { SYNC_INTERVAL_MS } from '../../queryClient.js';
import { changeShopping, listShoppingItems, listShoppingLists, type ShoppingChange } from './shoppingApi.js';

export function useShopping(selected: string | null) {
  const { user, family } = useMe();
  const client = useQueryClient();
  const key = ['shopping', family?.id, user?.id];
  const listsKey = [...key, 'lists'];
  const refresh = {
    refetchInterval: () => (client.isMutating({ mutationKey: key }) ? (false as const) : SYNC_INTERVAL_MS),
    refetchOnWindowFocus: () => (client.isMutating({ mutationKey: key }) === 0 ? ('always' as const) : false),
    refetchOnReconnect: () => (client.isMutating({ mutationKey: key }) === 0 ? ('always' as const) : false),
  };
  const lists = useQuery({ queryKey: listsKey, queryFn: ({ signal }) => listShoppingLists(signal), ...refresh });
  const active = lists.data?.find((list) => list.id === selected) ?? lists.data?.[0];
  const listId = active?.id;
  const itemsKey = [...key, 'items', listId];
  const items = useQuery({
    queryKey: itemsKey,
    queryFn: ({ signal }) => listShoppingItems(listId!, signal),
    enabled: !!listId,
    ...refresh,
  });
  const mutation = useMutation({
    mutationKey: key,
    mutationFn: changeShopping,
    onMutate: async (change: ShoppingChange) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueriesData<ShoppingList[] | ShoppingItem[]>({ queryKey: key });
      const now = Date.now();
      const metadata = { createdBy: user!.id, createdAt: now, updatedAt: now };
      if (change.type === 'createList') {
        client.setQueryData<ShoppingList[]>(listsKey, (old = []) => [
          ...old,
          { ...metadata, id: change.id, familyId: family!.id, name: change.name, position: old.length },
        ]);
      } else if (change.type === 'renameList' || change.type === 'deleteList') {
        client.setQueryData<ShoppingList[]>(listsKey, (old = []) =>
          change.type === 'deleteList'
            ? old.filter((list) => list.id !== change.id)
            : old.map((list) => (list.id === change.id ? { ...list, name: change.name, updatedAt: now } : list)),
        );
      } else {
        client.setQueryData<ShoppingItem[]>([...key, 'items', change.listId], (old = []) => {
          switch (change.type) {
            case 'add':
              return [
                ...old,
                {
                  ...metadata,
                  ...change.data,
                  category: change.data.category ?? 'other',
                  quantity: change.data.quantity ?? null,
                  id: change.id,
                  listId: change.listId,
                  isChecked: false,
                  checkedBy: null,
                  checkedAt: null,
                  position: old.length,
                },
              ];
            case 'remove':
              return old.filter((item) => item.id !== change.id);
            case 'clear':
              return old.filter((item) => !item.isChecked);
            case 'edit':
              return old.map((item) => {
                if (item.id !== change.id) return item;
                const checked = change.data.isChecked;
                return {
                  ...item,
                  name: change.data.name ?? item.name,
                  quantity: change.data.quantity === undefined ? item.quantity : change.data.quantity,
                  category: change.data.category ?? item.category,
                  position: change.data.position ?? item.position,
                  isChecked: change.data.isChecked ?? item.isChecked,
                  updatedAt: now,
                  ...(checked === undefined || checked === item.isChecked
                    ? {}
                    : { checkedBy: checked ? user!.id : null, checkedAt: checked ? now : null }),
                };
              });
          }
        });
      }
      return { previous };
    },
    onError: (_error, _change, context) => {
      // A cleared cache belongs to a logged-out or different account.
      context?.previous.forEach(([queryKey, data]) => {
        if (!client.getQueryState(queryKey)) return;
        if (data === undefined) client.removeQueries({ queryKey, exact: true });
        else client.setQueryData(queryKey, data);
      });
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
  return { lists, items, mutation, active };
}
