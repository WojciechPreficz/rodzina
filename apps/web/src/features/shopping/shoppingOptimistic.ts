import { mergeQuantities, normalizeShoppingName, type ShoppingItem, type ShoppingList } from '@rodzina/shared';
import type { ShoppingChange, MealShoppingProjection } from './shoppingApi.js';
import type { ShoppingData, StoredShoppingOperation } from './shoppingStorage.js';

export type ShoppingAccount = { familyId: string; userId: string };
export function shoppingAccount(account: string): ShoppingAccount {
  const [familyId, userId] = account.split(':');
  return { familyId: familyId!, userId: userId! };
}
export type ShoppingDataWriter = {
  setQueryData<T>(key: readonly string[], update: (old: T | undefined) => T): void;
};
export const shoppingKey = (account: ShoppingAccount) => ['shopping', account.familyId, account.userId];

export function applyShoppingChange(
  client: ShoppingDataWriter,
  account: ShoppingAccount,
  change: ShoppingChange | MealShoppingProjection,
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
        case 'mealExport': {
          const items = old.map((item) => ({ ...item }));
          for (const ingredient of change.ingredients) {
            const existing = items.find(
              (item) => !item.isChecked && normalizeShoppingName(item.name) === normalizeShoppingName(ingredient.name),
            );
            if (existing) existing.quantity = mergeQuantities(existing.quantity, ingredient.quantity);
            else
              items.push({
                ...metadata,
                id: ingredient.id,
                listId: change.listId,
                name: ingredient.name,
                quantity: ingredient.quantity,
                category: 'other',
                isChecked: false,
                checkedBy: null,
                checkedAt: null,
                position: items.length,
              });
          }
          return items;
        }
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

export function projectShopping(data: ShoppingData, changes: readonly StoredShoppingOperation[]) {
  const account = shoppingAccount(data.account);
  const key = shoppingKey(account);
  const projected = new Map(data.queries.map((query) => [JSON.stringify(query.queryKey), query.state.data]));
  const pending = changes.filter((operation) => !operation.review);
  const localLists = new Set(pending.flatMap(({ change }) => (change.type === 'createList' ? [change.id] : [])));
  const writer: ShoppingDataWriter = {
    setQueryData<T>(key: readonly string[], update: (old: T | undefined) => T) {
      const hash = JSON.stringify(key);
      projected.set(hash, update(projected.get(hash) as T | undefined));
    },
  };
  for (const { change, submittedAt } of pending) applyShoppingChange(writer, account, change, submittedAt);
  return {
    lists: projected.get(JSON.stringify([...key, 'lists'])) as ShoppingList[] | undefined,
    items: (listId: string) =>
      (projected.get(JSON.stringify([...key, 'items', listId])) as ShoppingItem[] | undefined) ??
      (localLists.has(listId) ? [] : undefined),
    localLists,
    pendingCount: pending.length,
  };
}
