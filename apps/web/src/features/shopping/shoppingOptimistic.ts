import type { QueryClient } from '@tanstack/react-query';
import type { ShoppingItem, ShoppingList } from '@rodzina/shared';
import type { ShoppingChange } from './shoppingApi.js';

export type ShoppingAccount = { familyId: string; userId: string };
export const shoppingKey = (account: ShoppingAccount) => ['shopping', account.familyId, account.userId];

export function applyShoppingChange(
  client: Pick<QueryClient, 'setQueryData'>,
  account: ShoppingAccount,
  change: ShoppingChange,
  submittedAt: number,
) {
  const key = shoppingKey(account);
  const listsKey = [...key, 'lists'];
  const now = submittedAt;
  const metadata = { createdBy: account.userId, createdAt: now, updatedAt: now };
  if (change.type === 'createList') {
    client.setQueryData<ShoppingList[]>(listsKey, (old = []) => [
      ...old.filter((list) => list.id !== change.id),
      { ...metadata, id: change.id, familyId: account.familyId, name: change.name, position: old.length },
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
            ...old.filter((item) => item.id !== change.id),
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
                : { checkedBy: checked ? account.userId : null, checkedAt: checked ? now : null }),
            };
          });
      }
    });
  }
}
