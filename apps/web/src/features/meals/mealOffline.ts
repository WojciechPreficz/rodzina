import { useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import {
  mealOfflineChangeSchema,
  mealWeekResponseSchema,
  mealsToShoppingListResponseSchema,
  normalizeShoppingName,
  type MealOfflineChange,
  type PutMeal,
  type Meal,
} from '@rodzina/shared';
import { apiFetch, ApiRequestError } from '../../api.js';
import { accountToken, isAccountCurrent, transact, assertContext } from '../../offline/database.js';
import { appendOperation, readOperations, recountOutboxBudgets } from '../../offline/outbox.js';
import { joinSync, type SyncAdapter } from '../../offline/sync.js';
import { notifyOutboxChanged, watchOutbox } from '../../offline/signals.js';
import { reportStorageIssue, storageError } from '../../offline/status.js';
import { readShoppingTransaction, putShoppingTransaction } from '../shopping/shoppingStorage.js';
import { applyShoppingChange, shoppingKey } from '../shopping/shoppingOptimistic.js';
import { flushShoppingPersistence, type ShoppingSession } from '../shopping/shoppingOffline.js';
import { readMeals, putMeals, emptyMeals, projectMeals, type MealCache, type MealOperation } from './mealStorage.js';
import { mealWeekStart, shiftMealDate } from './mealDates.js';

export function mealAdapter(account: string, client?: QueryClient): SyncAdapter {
  return {
    module: 'meals',
    prepare: async (op, signal) => {
      const session = await apiFetch<ShoppingSession>('/api/auth/me', { signal });
      if (`${session.family.id}:${session.user.id}` !== account)
        throw new ApiRequestError('Sesja konta uległa zmianie.', 401, 'SESSION_CHANGED');
      if (session.user.role === 'child')
        throw new ApiRequestError('Zapis jest dostępny tylko dla dorosłych.', 403, 'FORBIDDEN');
      if (client && mealOfflineChangeSchema.parse(op.payload).type === 'export') {
        await client.cancelQueries({
          queryKey: shoppingKey({ familyId: account.split(':')[0]!, userId: account.split(':')[1]! }),
        });
        await flushShoppingPersistence(client);
      }
    },
    send: async (op, signal) => {
      const change = mealOfflineChangeSchema.parse(op.payload);
      return apiFetch(
        `${change.type === 'export' ? '/api/meals/to-shopping-list' : '/api/meals/offline'}?operationId=${op.operationId}&actorId=${account.split(':')[1]}`,
        {
          signal,
          method: 'POST',
          body: JSON.stringify(change.type === 'export' ? change.data : change),
        },
      );
    },
    reconcile: async (tx, op, response) => {
      const { cache } = await readMeals(tx, account);
      const change = mealOfflineChangeSchema.parse(op.payload);
      if (change.type === 'write') {
        const week = mealWeekResponseSchema.parse((response as { week: unknown }).week);
        cache.weeks[week.weekStart] = { data: week, syncedAt: Date.now() };
      } else {
        const result = mealsToShoppingListResponseSchema.parse(response);
        if (!result.items) throw new Error('Brak wyniku synchronizacji zakupów.');
        cache.results[op.operationId] = { added: result.added, updated: result.updated };
        // Keep recent summaries without growing the account cache indefinitely.
        for (const id of Object.keys(cache.results).slice(0, -30)) delete cache.results[id];
        cache.exports[change.data.listId] = [
          ...new Set([
            ...(cache.exports[change.data.listId] ?? []),
            ...(change.data.snapshot ?? []).map((meal) => meal.mealId),
          ]),
        ];
        const shopping = await readShoppingTransaction(tx, account);
        if (!shopping) throw new Error('Brak zapisanej listy zakupów.');
        const key = [
          ...shoppingKey({ familyId: account.split(':')[0]!, userId: account.split(':')[1]! }),
          'items',
          change.data.listId,
        ];
        const range = shopping.queries.find((q) => JSON.stringify(q.queryKey) === JSON.stringify(key));
        if (!range) throw new Error('Brak zapisanej zawartości listy zakupów.');
        range.state = { ...range.state, data: result.items, dataUpdatedAt: Date.now() };
        // Later local checkbox/quantity edits may refer to an item merged into a different server ID.
        for (const later of await readOperations(tx, account)) {
          if (later.sequence <= op.sequence || later.module !== 'shopping') continue;
          const payload = later.payload as { id?: string };
          const id = payload.id && result.aliases?.[payload.id];
          if (id && id !== payload.id) tx.objectStore('outbox').put({ ...later, payload: { ...payload, id } });
        }
        await putShoppingTransaction(tx, shopping, true);
      }
      await putMeals(tx, cache);
    },
    invalidateAccess: async (tx, op, error) => {
      const change = mealOfflineChangeSchema.parse(op.payload);
      if (error.status !== 404 || change.type !== 'export') return;
      const shopping = await readShoppingTransaction(tx, account);
      if (shopping) {
        shopping.revokedLists = [...new Set([...(shopping.revokedLists ?? []), change.data.listId])];
        shopping.queries = shopping.queries
          .filter((q) => q.queryKey[4] !== change.data.listId)
          .map((q) =>
            q.queryKey[3] === 'lists'
              ? {
                  ...q,
                  state: {
                    ...q.state,
                    data: (q.state.data as { id: string }[]).filter((list) => list.id !== change.data.listId),
                  },
                }
              : q,
          );
        await putShoppingTransaction(tx, shopping, true);
      }
    },
  };
}

type MealState = { account: string; cache: MealCache; operations: MealOperation[]; ready: boolean };
const listeners = new Set<() => void>();
let state: MealState = { account: '', cache: emptyMeals(''), operations: [], ready: false };
let session: ShoppingSession | undefined;
let queryClient: QueryClient | undefined;
let sync: ReturnType<typeof joinSync> | undefined;
let unwatch: (() => void) | undefined;
let token = -1;
let reloadQueue = Promise.resolve();
const emit = () => {
  listeners.forEach((listener) => listener());
};
export const useMealState = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
export const mealRevision = (week: string) =>
  JSON.stringify([
    token,
    state.account,
    state.cache.weeks[week],
    state.operations.filter((op) => op.payload.type === 'write' && op.payload.weekStart === week),
  ]);
function reload() {
  const captured = token;
  const account = state.account;
  const loading = reloadQueue.then(async () => {
    if (!isAccountCurrent(captured) || token !== captured || state.account !== account) return;
    const data = await transact('readonly', (tx) => readMeals(tx, account), captured);
    if (!isAccountCurrent(captured) || token !== captured || state.account !== account) return;
    state = { account, ...data, ready: true };
    emit();
  });
  reloadQueue = loading.catch(() => {});
  return loading;
}
export function stopMeals() {
  sync?.stop();
  sync = undefined;
  unwatch?.();
  unwatch = undefined;
  session = undefined;
  queryClient = undefined;
  token = -1;
  state = { account: '', cache: emptyMeals(''), operations: [], ready: false };
  emit();
}
export async function restoreMeals(_client: QueryClient, next: ShoppingSession) {
  const account = `${next.family.id}:${next.user.id}`;
  if (state.account === account && isAccountCurrent(token) && session) {
    session = next;
    return;
  }
  stopMeals();
  const captured = accountToken();
  token = captured;
  session = next;
  queryClient = _client;
  state = { account, cache: emptyMeals(account), operations: [], ready: false };
  try {
    await reload();
    if (token !== captured || !isAccountCurrent(captured)) return;
    unwatch = watchOutbox(account, () => {
      void reload().catch(() => {});
    });
    sync = joinSync(account, mealAdapter(account, _client), reload);
  } catch (error) {
    if (token === captured && isAccountCurrent(captured)) reportStorageIssue(storageError(error));
  }
}
export function visibleMeals() {
  return projectMeals(state.cache, state.operations, session?.user.id ?? '');
}
export async function saveMealWeek(week: unknown, expectedRevision: string) {
  const data = mealWeekResponseSchema.parse(week);
  const captured = token;
  const account = state.account;
  await transact(
    'readwrite',
    async (tx) => {
      const saved = await readMeals(tx, account);
      if (expectedRevision !== mealRevision(data.weekStart)) return;
      // Compare durable state as well: another tab may have committed before its signal arrived.
      if (
        JSON.stringify(
          saved.operations.filter((op) => op.payload.type === 'write' && op.payload.weekStart === data.weekStart),
        ) !==
        JSON.stringify(
          state.operations.filter((op) => op.payload.type === 'write' && op.payload.weekStart === data.weekStart),
        )
      )
        return;
      if (JSON.stringify(saved.cache.weeks[data.weekStart]) !== JSON.stringify(state.cache.weeks[data.weekStart]))
        return;
      saved.cache.weeks[data.weekStart] = { data, syncedAt: Date.now() };
      await putMeals(tx, saved.cache);
    },
    captured,
  );
  if (token === captured && isAccountCurrent(captured)) await reload();
}
export async function saveMealSuggestions(account: string, suggestions: MealCache['suggestions']) {
  const captured = token;
  if (account !== state.account) throw new DOMException('Session changed', 'AbortError');
  await transact(
    'readwrite',
    async (tx) => {
      const { cache } = await readMeals(tx, account);
      cache.suggestions = suggestions;
      await putMeals(tx, cache);
    },
    captured,
  );
  if (token === captured && isAccountCurrent(captured)) await reload();
}
export async function queueMealChange(
  build: (
    cache: MealCache,
    operations: MealOperation[],
    tx: IDBTransaction,
  ) => Promise<MealOfflineChange> | MealOfflineChange,
) {
  if (!session || session.user.role === 'child' || !state.ready || !isAccountCurrent(token))
    throw new Error('Pamięć obiadów nie jest gotowa lub nie masz uprawnień do zapisu.');
  const account = state.account;
  const captured = token;
  const userId = session.user.id;
  const result = await transact(
    'readwrite',
    async (tx) => {
      const saved = await readMeals(tx, account);
      const projected = projectMeals(saved.cache, saved.operations, userId);
      const change = mealOfflineChangeSchema.parse(await build(projected, saved.operations, tx));
      const orderingKeys =
        change.type === 'export'
          ? [`meals:week:${change.data.weekStart}`, `shopping:list:${change.data.listId}`]
          : [`meals:week:${change.weekStart}`];
      const operations = await readOperations(tx, account);
      const operationId = crypto.randomUUID();
      await appendOperation(tx, account, 'meals', {
        operationId,
        submittedAt: Date.now(),
        entityId: orderingKeys[0]!,
        orderingKeys,
        payload: change,
        dependsOn: operations
          .filter((op) => op.orderingKeys.some((key) => orderingKeys.includes(key)))
          .map((op) => op.operationId),
      });
      await putMeals(tx, saved.cache);
      if (change.type === 'export') {
        const shopping = await readShoppingTransaction(tx, account);
        if (!shopping) throw new Error('Najpierw pobierz listę zakupów.');
        await putShoppingTransaction(tx, shopping, true);
      }
      return { ...change, operationId };
    },
    captured,
  );
  if (token !== captured || !isAccountCurrent(captured)) throw new DOMException('Session changed', 'AbortError');
  await reload();
  sync?.wake();
  return result;
}
export function queueMeal(date: string, data: PutMeal | null) {
  return queueMealChange((cache) => {
    const weekStart = mealWeekStart(date);
    const week = cache.weeks[weekStart];
    if (!week) throw new Error('Ten tydzień nie został pobrany. Połącz się z internetem.');
    const existing = week.data.days.find((day) => day.date === date)?.meals[0];
    return {
      type: 'write',
      weekStart,
      writes: [{ date, id: existing?.id ?? crypto.randomUUID(), expectedId: existing?.id ?? null, data }],
    };
  });
}
export function queueMealCopy(weekStart: string, overwrite: boolean) {
  return queueMealChange((cache) => {
    const source = cache.weeks[shiftMealDate(weekStart, -7)];
    const target = cache.weeks[weekStart];
    if (!source || !target) throw new Error('Najpierw pobierz tydzień źródłowy i docelowy.');
    const writes = source.data.days.flatMap((day, index) => {
      const meal = day.meals[0];
      const previous = target.data.days[index]!.meals[0];
      if (!meal || (!overwrite && previous)) return [];
      return [
        {
          date: target.data.days[index]!.date,
          id: previous?.id ?? crypto.randomUUID(),
          expectedId: previous?.id ?? null,
          data: { title: meal.title, notes: meal.notes, ingredients: meal.ingredients },
        },
      ];
    });
    return { type: 'write', weekStart, writes };
  });
}
export async function queueMealExport(weekStart: string, listId: string, mealIds: string[], confirmRepeat: boolean) {
  const captured = token;
  if (queryClient) await flushShoppingPersistence(queryClient);
  if (captured !== token || !isAccountCurrent(captured)) throw new DOMException('Session changed', 'AbortError');
  return queueMealChange(async (cache, operations, tx) => {
    const week = cache.weeks[weekStart];
    const meals = week?.data.days.flatMap((day) => day.meals).filter((meal) => mealIds.includes(meal.id));
    if (!meals?.length || meals.length !== mealIds.length)
      throw new Error('Wybrane obiady zmieniły się. Otwórz eksport ponownie.');
    const repeated =
      (cache.exports[listId] ?? []).some((id) => mealIds.includes(id)) ||
      operations.some(
        (op) =>
          op.payload.type === 'export' &&
          op.payload.data.listId === listId &&
          op.payload.data.snapshot?.some((meal) => mealIds.includes(meal.mealId)),
      );
    if (repeated && !confirmRepeat)
      throw new ApiRequestError('Potwierdź ponowne dodanie ilości.', 409, 'MEAL_EXPORT_CONFIRMATION_REQUIRED');
    const shopping = await readShoppingTransaction(tx, cache.account);
    if (!shopping) throw new Error('Najpierw pobierz listę zakupów.');
    const projected = new Map(shopping.queries.map((q) => [JSON.stringify(q.queryKey), q.state.data]));
    const account = { familyId: cache.account.split(':')[0]!, userId: cache.account.split(':')[1]! };
    const client = {
      setQueryData: (key: readonly unknown[], update: (old: unknown) => unknown) => {
        const value = update(projected.get(JSON.stringify(key)));
        projected.set(JSON.stringify(key), value);
        return value;
      },
    } as Pick<QueryClient, 'setQueryData'>;
    for (const op of shopping.operations.filter((op) => !op.review))
      applyShoppingChange(client, account, op.change, op.submittedAt);
    const lists = projected.get(JSON.stringify([...shoppingKey(account), 'lists'])) as { id: string }[] | undefined;
    const items = (projected.get(JSON.stringify([...shoppingKey(account), 'items', listId])) ??
      (shopping.operations.some((op) => op.change.type === 'createList' && op.change.id === listId && !op.review)
        ? []
        : undefined)) as { id: string; name: string; isChecked: boolean }[] | undefined;
    if (!lists?.some((list) => list.id === listId) || !items)
      throw new Error('Najpierw pobierz zawartość docelowej listy zakupów.');
    const targets = new Map<string, { name: string; id: string }>();
    for (const meal of meals)
      for (const ingredient of meal.ingredients) {
        const key = normalizeShoppingName(ingredient.name);
        if (!targets.has(key))
          targets.set(key, {
            name: ingredient.name,
            id:
              items.find((item) => !item.isChecked && normalizeShoppingName(item.name) === key)?.id ??
              crypto.randomUUID(),
          });
      }
    return {
      type: 'export',
      data: {
        weekStart,
        listId,
        mealIds,
        confirmRepeat,
        snapshot: meals.map((meal) => ({ mealId: meal.id, date: meal.date, ingredients: meal.ingredients })),
        targets: [...targets.values()],
      },
    };
  });
}
export async function confirmMealExport(operationId: string) {
  await transact(
    'readwrite',
    async (tx) => {
      await assertContext(tx);
      const operations = await readOperations(tx, state.account);
      const op = operations.find((op) => op.operationId === operationId && op.module === 'meals');
      if (!op || op.status !== 'needs-review') throw new Error('Ta zmiana wymaga ręcznego sprawdzenia.');
      const change = mealOfflineChangeSchema.parse(op.payload);
      if (change.type !== 'export' || op.reviewReason !== 'MEAL_EXPORT_CONFIRMATION_REQUIRED')
        throw new Error('Nie można potwierdzić tej zmiany.');
      tx.objectStore('outbox').put({
        ...op,
        status: 'pending',
        reviewReason: undefined,
        lastError: undefined,
        payload: { ...change, data: { ...change.data, confirmRepeat: true } },
      });
      const blocked = new Set<string>();
      const blockedKeys = new Set<string>();
      for (const child of operations) {
        if (child.operationId === op.operationId) continue;
        if (
          child.status === 'needs-review' &&
          child.reviewReason === 'dependency' &&
          !child.dependsOn.some((id) => blocked.has(id)) &&
          !child.orderingKeys.some((key) => blockedKeys.has(key))
        ) {
          tx.objectStore('outbox').put({ ...child, status: 'pending', reviewReason: undefined, lastError: undefined });
        } else if (child.status === 'needs-review') {
          blocked.add(child.operationId);
          child.orderingKeys.forEach((key) => blockedKeys.add(key));
        }
      }
      notifyOutboxChanged(tx, state.account);
    },
    token,
  );
  await reload();
  sync?.wake();
}
export async function discardMealOperation(operationId: string) {
  await transact(
    'readwrite',
    async (tx) => {
      await assertContext(tx);
      const operations = await readOperations(tx, state.account);
      const selected = operations.find(
        (op) => op.module === 'meals' && op.operationId === operationId && op.status === 'needs-review',
      );
      if (!selected) throw new Error('Można odrzucić tylko zmianę wymagającą sprawdzenia.');
      const removed = new Set<string>();
      const keys = new Set<string>();
      for (const op of operations) {
        if (
          op === selected ||
          op.dependsOn.some((id) => removed.has(id)) ||
          op.orderingKeys.some((key) => keys.has(key))
        ) {
          removed.add(op.operationId);
          op.orderingKeys.forEach((key) => keys.add(key));
          tx.objectStore('outbox').delete([state.account, op.operationId]);
        }
      }
      await recountOutboxBudgets(tx, state.account);
      notifyOutboxChanged(tx, state.account);
    },
    token,
  );
  await reload();
  sync?.wake();
}
export function localMealSuggestions(cache: MealCache, search: string) {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('pl').replace(/\s+/g, ' ').trim();
  const meals: Pick<Meal, 'title' | 'ingredients'>[] = Object.values(cache.weeks)
    .flatMap((week) => week.data.days.flatMap((day) => day.meals))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const seen = new Set<string>();
  return [...meals, ...cache.suggestions]
    .filter((meal) => {
      const key = normalize(meal.title);
      if (!key.includes(normalize(search)) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
}
