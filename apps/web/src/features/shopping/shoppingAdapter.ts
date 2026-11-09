import type { ShoppingItem, ShoppingList } from '@rodzina/shared';
import { apiFetch } from '../../api.js';
import type { Intent, Operation, OfflineTransaction, SyncAdapter } from '../../offline/index.js';
import { changeShopping, listShoppingLists, listShoppingItems, type ShoppingChange } from './shoppingApi.js';
import { applyShoppingChange, shoppingAccount, type ShoppingDataWriter } from './shoppingOptimistic.js';
import {
  readShoppingTransaction,
  readShoppingData,
  putShoppingTransaction,
  shoppingUsesOutbox,
  shoppingOperation,
  rangeListId,
  type ShoppingRange,
  type ShoppingData,
  type StoredShoppingOperation,
  type QueuedShoppingChange,
} from './shoppingStorage.js';

export function shoppingIntent(op: QueuedShoppingChange, reviewReason?: string): Intent {
  const change = op.change;
  const listId = 'listId' in change ? change.listId : change.id;
  return {
    operationId: op.operationId,
    submittedAt: op.submittedAt,
    payload: change,
    entityId: 'id' in change ? change.id : listId,
    orderingKeys: [`shopping:list:${listId}`],
    ...(reviewReason ? { reviewReason } : {}),
  };
}
export async function takeOverShopping(tx: OfflineTransaction, data: ShoppingData) {
  if (await shoppingUsesOutbox(tx)) return;
  for (const op of data.operations) {
    if (op.change.type === 'mealExport') throw new Error('Eksport wymaga wspólnej kolejki.');
    await tx.appendChange('shopping', shoppingIntent({ ...op, change: op.change }, op.review));
  }
  await putShoppingTransaction(tx, data, true);
}
function projected(
  data: ShoppingData,
  account: ReturnType<typeof shoppingAccount>,
  op: Pick<StoredShoppingOperation, 'change' | 'submittedAt'>,
  response: unknown,
) {
  const ranges = new Map(data.ranges.map((range) => [rangeListId(range), range]));
  const cache: ShoppingDataWriter = {
    updateLists(update) {
      const old = ranges.get(null);
      if (ranges.size)
        ranges.set(null, {
          kind: 'lists',
          data: update(old?.kind === 'lists' ? old.data : undefined),
          syncedAt: Date.now(),
        });
    },
    updateItems(listId, update) {
      const old = ranges.get(listId);
      if (ranges.size)
        ranges.set(listId, {
          kind: 'items',
          listId,
          data: update(old?.kind === 'items' ? old.data : undefined),
          syncedAt: Date.now(),
        });
    },
  };
  applyShoppingChange(cache, account, op.change, op.submittedAt);
  const result = response as { item?: ShoppingItem; list?: ShoppingList };
  if (result?.item)
    cache.updateItems(result.item.listId, (old = []) =>
      old.map((item) => (item.id === result.item!.id ? result.item! : item)),
    );
  if (result?.list)
    cache.updateLists((old = []) => old.map((list) => (list.id === result.list!.id ? result.list! : list)));
  return [...ranges.values()];
}

export function shoppingAdapter(accountId: string): Omit<SyncAdapter, 'module'> {
  const account = shoppingAccount(accountId);
  return {
    sessionTransport: apiFetch,
    send: async (operation, signal) => {
      // Confirm a legacy cache online before replay. Never invert destructive intents heuristically.
      const data = await readShoppingData(accountId);
      if (data?.legacyCache) {
        const lists = await listShoppingLists(signal);
        const ranges = await Promise.all(
          data.ranges
            .filter(
              (range): range is Extract<ShoppingRange, { kind: 'items' }> =>
                range.kind === 'items' && lists.some((list) => list.id === range.listId),
            )
            .map(async (range) => ({
              ...range,
              data: await listShoppingItems(range.listId, signal),
              syncedAt: Date.now(),
            })),
        );
        // Base refresh is committed by reconciliation, not by an unfenced request.
        const response = await changeShopping(
          operation.payload as ShoppingChange,
          operation.operationId,
          account.userId,
          signal,
        );
        return { response, base: { lists, ranges } };
      }
      return {
        response: await changeShopping(
          operation.payload as ShoppingChange,
          operation.operationId,
          account.userId,
          signal,
        ),
      };
    },
    reconcile: async (tx, operation, result) => {
      let data = (await readShoppingTransaction(tx, accountId))!;
      const { response, base } = result as {
        response: unknown;
        base?: { lists: ShoppingList[]; ranges: ShoppingData['ranges'] };
      };
      if (base) {
        data = {
          ...data,
          legacyCache: false,
          ranges: data.ranges.map((q) =>
            q.kind === 'lists'
              ? { ...q, data: base.lists, syncedAt: Date.now() }
              : (base.ranges.find((range) => rangeListId(range) === rangeListId(q)) ?? q),
          ),
        };
      }
      await putShoppingTransaction(
        tx,
        { ...data, ranges: projected(data, account, shoppingOperation(operation), response) },
        true,
      );
    },
    invalidateAccess: async (tx, operation: Operation, error) => {
      // Shopping is family-visible; FORBIDDEN denies a write, not list visibility.
      if (error.status === 403) return;
      const data = (await readShoppingTransaction(tx, accountId))!;
      const change = operation.payload as ShoppingChange;
      const listId = 'listId' in change ? change.listId : change.id;
      if (change.type === 'edit' || change.type === 'remove') {
        await putShoppingTransaction(
          tx,
          {
            ...data,
            ranges: data.ranges.map((q) =>
              q.kind === 'items' && q.listId === listId
                ? {
                    ...q,
                    data: q.data.filter((item) => item.id !== change.id),
                  }
                : q,
            ),
          },
          true,
        );
        return;
      }
      await putShoppingTransaction(
        tx,
        {
          ...data,
          revokedLists: [...new Set([...(data.revokedLists ?? []), listId])],
          ranges: data.ranges
            .filter((q) => rangeListId(q) !== listId)
            .map((q) =>
              q.kind === 'lists'
                ? {
                    ...q,
                    data: q.data.filter((list) => list.id !== listId),
                  }
                : q,
            ),
        },
        true,
      );
    },
  };
}
