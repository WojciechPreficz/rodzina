import type { QueryClient } from '@tanstack/react-query';
import type { ShoppingItem, ShoppingList } from '@rodzina/shared';
import { apiFetch, ApiRequestError } from '../../api.js';
import { assertContext, transact } from '../../offline/database.js';
import { appendOperation, type Intent, type Operation } from '../../offline/outbox.js';
import type { SyncAdapter } from '../../offline/sync.js';
import { changeShopping, listShoppingLists, listShoppingItems, type ShoppingChange } from './shoppingApi.js';
import { applyShoppingChange, shoppingKey, type ShoppingAccount } from './shoppingOptimistic.js';
import {
  readShoppingTransaction,
  putShoppingTransaction,
  shoppingUsesOutbox,
  shoppingOperation,
  type ShoppingData,
  type StoredShoppingOperation,
} from './shoppingStorage.js';
import type { QueuedShoppingChange, ShoppingSession } from './shoppingOffline.js';

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
export async function takeOverShopping(accountId: string) {
  await transact('readwrite', async (tx) => {
    const active = await assertContext(tx);
    if (active.accountId !== accountId) throw new DOMException('Session changed', 'AbortError');
    if (await shoppingUsesOutbox(tx, accountId)) return;
    const data = await readShoppingTransaction(tx, accountId);
    if (!data) throw new Error('Brak pamięci zakupów do przeniesienia.');
    for (const op of data.operations) {
      if (op.change.type === 'mealExport') throw new Error('Eksport wymaga wspólnej kolejki.');
      await appendOperation(tx, accountId, 'shopping', shoppingIntent({ ...op, change: op.change }, op.review));
    }
    await putShoppingTransaction(tx, data, true);
  });
}
function projected(
  data: ShoppingData,
  account: ShoppingAccount,
  op: Pick<StoredShoppingOperation, 'change' | 'submittedAt'>,
  response: unknown,
) {
  const queries = new Map(data.queries.map((q) => [JSON.stringify(q.queryKey), q]));
  const cache = {
    setQueryData: (key: readonly unknown[], update: (old: unknown) => unknown) => {
      const hash = JSON.stringify(key);
      const old = queries.get(hash);
      // A missing range is not an empty list. New local lists have a known empty base.
      const value = update(old?.state.data);
      const template = old ?? data.queries[0];
      if (template)
        queries.set(hash, {
          ...template,
          queryKey: [...key],
          queryHash: hash,
          state: { ...template.state, data: value, dataUpdatedAt: Date.now() },
        });
      return value;
    },
  } as Pick<QueryClient, 'setQueryData'>;
  applyShoppingChange(cache, account, op.change, op.submittedAt);
  const result = response as { item?: ShoppingItem; list?: ShoppingList };
  if (result?.item)
    cache.setQueryData<ShoppingItem[]>([...shoppingKey(account), 'items', result.item.listId], (old = []) =>
      old.map((item) => (item.id === result.item!.id ? result.item! : item)),
    );
  if (result?.list)
    cache.setQueryData<ShoppingList[]>([...shoppingKey(account), 'lists'], (old = []) =>
      old.map((list) => (list.id === result.list!.id ? result.list! : list)),
    );
  return [...queries.values()];
}

export function shoppingAdapter(account: ShoppingAccount): SyncAdapter {
  const accountId = `${account.familyId}:${account.userId}`;
  return {
    module: 'shopping',
    prepare: async (_operation, signal) => {
      const session = await apiFetch<ShoppingSession>('/api/auth/me', { signal });
      if (`${session.family.id}:${session.user.id}` !== accountId)
        throw new ApiRequestError('Sesja konta uległa zmianie.', 401, 'SESSION_CHANGED');
    },
    send: async (operation, signal) => {
      // Confirm a legacy cache online before replay. Never invert destructive intents heuristically.
      const data = await transact('readonly', (tx) => readShoppingTransaction(tx, accountId));
      if (data?.legacyCache) {
        const lists = await listShoppingLists(signal);
        const ranges = await Promise.all(
          data.queries
            .filter((q) => q.queryKey[3] === 'items' && lists.some((list) => list.id === q.queryKey[4]))
            .map(async (q) => ({
              ...q,
              state: {
                ...q.state,
                data: await listShoppingItems(String(q.queryKey[4]), signal),
                dataUpdatedAt: Date.now(),
              },
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
        base?: { lists: ShoppingList[]; ranges: ShoppingData['queries'] };
      };
      if (base) {
        data = {
          ...data,
          legacyCache: false,
          queries: data.queries.map((q) =>
            q.queryKey[3] === 'lists'
              ? { ...q, state: { ...q.state, data: base.lists, dataUpdatedAt: Date.now() } }
              : (base.ranges.find((range) => range.queryHash === q.queryHash) ?? q),
          ),
        };
      }
      await putShoppingTransaction(
        tx,
        { ...data, queries: projected(data, account, shoppingOperation(operation), response) },
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
            queries: data.queries.map((q) =>
              q.queryKey[3] === 'items' && q.queryKey[4] === listId
                ? {
                    ...q,
                    state: {
                      ...q.state,
                      data: (q.state.data as ShoppingItem[]).filter((item) => item.id !== change.id),
                    },
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
          queries: data.queries
            .filter((q) => q.queryKey[4] !== listId)
            .map((q) =>
              q.queryKey[3] === 'lists'
                ? {
                    ...q,
                    state: { ...q.state, data: (q.state.data as ShoppingList[]).filter((list) => list.id !== listId) },
                  }
                : q,
            ),
        },
        true,
      );
    },
  };
}
