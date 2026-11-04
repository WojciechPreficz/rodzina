import type { QueryClient } from '@tanstack/react-query';
import { normalizeShoppingName, type ShoppingItem, type ShoppingList } from '@rodzina/shared';
import { readOperations } from '../../offline/outbox.js';
import { projectShopping, shoppingAccount, shoppingKey } from './shoppingOptimistic.js';
import { putShoppingTransaction, readShoppingTransaction } from './shoppingStorage.js';

export async function prepareMealExportSync(client: QueryClient, accountId: string) {
  // Shopping queries pause automatic refresh while meals sync. Cancel any earlier fetch.
  await client.cancelQueries({ queryKey: shoppingKey(shoppingAccount(accountId)) });
}

export async function resolveMealExportTargets(
  tx: IDBTransaction,
  accountId: string,
  listId: string,
  ingredients: readonly { name: string }[],
) {
  const shopping = await readShoppingTransaction(tx, accountId);
  if (!shopping) throw new Error('Najpierw pobierz listę zakupów.');
  const projected = projectShopping(shopping, shopping.operations);
  const lists = projected.lists;
  const items = projected.items(listId);
  if (!lists?.some((list) => list.id === listId) || !items)
    throw new Error('Najpierw pobierz zawartość docelowej listy zakupów.');

  const targets = new Map<string, { name: string; id: string }>();
  for (const { name } of ingredients) {
    const normalized = normalizeShoppingName(name);
    if (!targets.has(normalized))
      targets.set(normalized, {
        name,
        id:
          items.find((item) => !item.isChecked && normalizeShoppingName(item.name) === normalized)?.id ??
          crypto.randomUUID(),
      });
  }
  return [...targets.values()];
}

export async function projectQueuedMealExport(tx: IDBTransaction, accountId: string) {
  // Read the projection after appending the export so its base stays pinned.
  const shopping = await readShoppingTransaction(tx, accountId);
  if (!shopping) throw new Error('Najpierw pobierz listę zakupów.');
  await putShoppingTransaction(tx, shopping, true);
}

export async function reconcileMealExport(
  tx: IDBTransaction,
  accountId: string,
  listId: string,
  sequence: number,
  items: ShoppingItem[],
  aliases?: Record<string, string>,
) {
  const shopping = await readShoppingTransaction(tx, accountId);
  if (!shopping) throw new Error('Brak zapisanej listy zakupów.');
  const key = JSON.stringify([...shoppingKey(shoppingAccount(accountId)), 'items', listId]);
  const range = shopping.queries.find((q) => JSON.stringify(q.queryKey) === key);
  if (!range) throw new Error('Brak zapisanej zawartości listy zakupów.');
  range.state = { ...range.state, data: items, dataUpdatedAt: Date.now() };
  // Later local checkbox/quantity edits may refer to an item merged into a different server ID.
  for (const later of await readOperations(tx, accountId)) {
    if (later.sequence <= sequence || later.module !== 'shopping') continue;
    const payload = later.payload as { id?: string };
    const id = payload.id && aliases?.[payload.id];
    if (id && id !== payload.id) tx.objectStore('outbox').put({ ...later, payload: { ...payload, id } });
  }
  await putShoppingTransaction(tx, shopping, true);
}

export async function revokeMealExportList(tx: IDBTransaction, accountId: string, listId: string) {
  const shopping = await readShoppingTransaction(tx, accountId);
  if (!shopping) return;
  shopping.revokedLists = [...new Set([...(shopping.revokedLists ?? []), listId])];
  shopping.queries = shopping.queries
    .filter((q) => q.queryKey[4] !== listId)
    .map((q) =>
      q.queryKey[3] === 'lists'
        ? {
            ...q,
            state: {
              ...q.state,
              data: (q.state.data as ShoppingList[]).filter((list) => list.id !== listId),
            },
          }
        : q,
    );
  await putShoppingTransaction(tx, shopping, true);
}
