import type { QueryClient } from '@tanstack/react-query';
import { normalizeShoppingName, type ShoppingItem } from '@rodzina/shared';
import type { OfflineTransaction } from '../../offline/index.js';
import { projectShopping, shoppingAccount, shoppingKey } from './shoppingOptimistic.js';
import { putShoppingTransaction, readShoppingTransaction, rangeListId } from './shoppingStorage.js';

export async function prepareMealExportSync(client: QueryClient, accountId: string) {
  // Shopping queries pause automatic refresh while meals sync. Cancel any earlier fetch.
  await client.cancelQueries({ queryKey: shoppingKey(shoppingAccount(accountId)) });
}

export async function resolveMealExportTargets(
  tx: OfflineTransaction,
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

export async function projectQueuedMealExport(tx: OfflineTransaction, accountId: string) {
  // Read the projection after appending the export so its base stays pinned.
  const shopping = await readShoppingTransaction(tx, accountId);
  if (!shopping) throw new Error('Najpierw pobierz listę zakupów.');
  await putShoppingTransaction(tx, shopping, true);
}

export async function reconcileMealExport(
  tx: OfflineTransaction,
  accountId: string,
  listId: string,
  sequence: number,
  items: ShoppingItem[],
  aliases?: Record<string, string>,
) {
  const shopping = await readShoppingTransaction(tx, accountId);
  if (!shopping) throw new Error('Brak zapisanej listy zakupów.');
  const range = shopping.ranges.find((q) => q.kind === 'items' && q.listId === listId);
  if (range?.kind !== 'items') throw new Error('Brak zapisanej zawartości listy zakupów.');
  range.data = items;
  range.syncedAt = Date.now();
  // Later local checkbox/quantity edits may refer to an item merged into a different server ID.
  for (const later of await tx.readChanges()) {
    if (later.sequence <= sequence || later.module !== 'shopping') continue;
    const payload = later.payload as { id?: string };
    const id = payload.id && aliases?.[payload.id];
    if (id && id !== payload.id) tx.replaceChange({ ...later, payload: { ...payload, id } });
  }
  await putShoppingTransaction(tx, shopping, true);
}

export async function revokeMealExportList(tx: OfflineTransaction, accountId: string, listId: string) {
  const shopping = await readShoppingTransaction(tx, accountId);
  if (!shopping) return;
  shopping.revokedLists = [...new Set([...(shopping.revokedLists ?? []), listId])];
  shopping.ranges = shopping.ranges
    .filter((range) => rangeListId(range) !== listId)
    .map((range) =>
      range.kind === 'lists' ? { ...range, data: range.data.filter((list) => list.id !== listId) } : range,
    );
  await putShoppingTransaction(tx, shopping, true);
}
