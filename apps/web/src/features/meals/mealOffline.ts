import type { AccountSession } from '../../session.js';
import { useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import {
  mealOfflineChangeSchema,
  mealWeekResponseSchema,
  mealsToShoppingListResponseSchema,
  type MealOfflineChange,
  type PutMeal,
  type Meal,
} from '@rodzina/shared';
import { apiFetch, ApiRequestError } from '../../api.js';
import { transact, assertContext } from '../../offline/database.js';
import { registerOfflineModule } from '../../offline/moduleStore.js';
import { appendOperation, readOperations, recountOutboxBudgets } from '../../offline/outbox.js';
import type { SyncAdapter } from '../../offline/sync.js';
import { notifyOutboxChanged } from '../../offline/signals.js';
import { reportStorageIssue } from '../../offline/status.js';
import {
  prepareMealExportSync,
  resolveMealExportTargets,
  projectQueuedMealExport,
  reconcileMealExport,
  revokeMealExportList,
} from '../shopping/index.js';
import {
  readMeals,
  putMeals,
  readMealChanges,
  mealCache,
  projectMeals,
  type MealCache,
  type MealOperation,
} from './mealStorage.js';
import { mealWeekStart, shiftMealDate } from './mealDates.js';

export function mealAdapter(account: string, client?: QueryClient): SyncAdapter {
  return {
    module: 'meals',
    sessionTransport: apiFetch,
    prepare: async (op, _signal, { session }) => {
      if (session?.user.role === 'child')
        throw new ApiRequestError('Zapis jest dostępny tylko dla dorosłych.', 403, 'FORBIDDEN');
      if (client && mealOfflineChangeSchema.parse(op.payload).type === 'export')
        await prepareMealExportSync(client, account);
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
        // A replay from a previous app version returns only the first meal for each day.
        if (!change.byId) {
          const known = cache.weeks[week.weekStart]?.data.days;
          for (const [index, day] of week.days.entries()) {
            const additional = known?.[index]?.meals.slice(1) ?? [];
            day.meals.push(...additional.filter((meal) => !day.meals.some((item) => item.id === meal.id)));
          }
        }
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
        await reconcileMealExport(tx, account, change.data.listId, op.sequence, result.items, result.aliases);
      }
      await putMeals(tx, cache);
    },
    invalidateAccess: async (tx, op, error) => {
      const change = mealOfflineChangeSchema.parse(op.payload);
      if (error.status !== 404 || change.type !== 'export') return;
      await revokeMealExportList(tx, account, change.data.listId);
    },
  };
}

const mealsModule = registerOfflineModule({
  mode: 'read-write',
  cache: mealCache,
  readError: (detail) => detail,
  readChanges: readMealChanges,
  project: (saved, operations) => ({ cache: saved && projectMeals(saved, operations), operations }),
  sync: (account, getClient?: () => QueryClient | undefined) => mealAdapter(account, getClient?.()),
});

let session: { client: QueryClient; role: AccountSession['user']['role'] } | undefined;
export const mealStore = mealsModule.createStore(() => session?.client);
export const useMealState = () => useSyncExternalStore(mealStore.subscribe, mealStore.snapshot);

export function stopMeals() {
  session = undefined;
  mealStore.clear();
}

export async function restoreMeals(client: QueryClient, next: AccountSession) {
  session = { client, role: next.user.role };
  const ready = mealStore.activate(`${next.family.id}:${next.user.id}`);
  const scope = mealStore.accountScope();
  await ready;
  const { issue } = mealStore.snapshot();
  if (scope.current() && issue) reportStorageIssue(issue);
}

export const registerMealsStore = () => mealsModule.registerStore({ restore: restoreMeals, clear: stopMeals });

type MealScope = ReturnType<typeof mealStore.accountScope>;
const aborted = () => new DOMException('Session changed', 'AbortError');

async function commitMeals<T>(scope: MealScope, write: (tx: IDBTransaction, account: string) => Promise<T>) {
  const { account, token } = scope;
  const result = await transact(
    'readwrite',
    async (tx) => {
      if (!scope.current() || (await assertContext(tx)).accountId !== account) throw aborted();
      const result = await write(tx, account);
      if (!scope.current()) throw aborted();
      return result;
    },
    token,
  );
  if (!scope.current()) throw aborted();
  await mealStore.reload();
  if (!scope.current()) throw aborted();
  return result;
}

function weekRevision(week: string, cache?: MealCache, operations?: readonly MealOperation[]) {
  return JSON.stringify([
    cache?.weeks[week],
    operations?.filter((op) => op.payload.type === 'write' && op.payload.weekStart === week) ?? [],
  ]);
}

export function mealRevision(week: string) {
  const { saved, view } = mealStore.snapshot();
  return { scope: mealStore.accountScope(), value: weekRevision(week, saved, view?.operations) };
}

export async function saveMealWeek(week: unknown, expected: ReturnType<typeof mealRevision>) {
  const data = mealWeekResponseSchema.parse(week);
  await commitMeals(expected.scope, async (tx, account) => {
    const saved = await readMeals(tx, account);
    if (expected.value !== mealRevision(data.weekStart).value) return;
    // Another tab may have committed before its signal arrived.
    if (expected.value !== weekRevision(data.weekStart, saved.cache, saved.operations)) return;
    saved.cache.weeks[data.weekStart] = { data, syncedAt: Date.now() };
    await putMeals(tx, saved.cache);
  });
}

export async function saveMealSuggestions(scope: MealScope, suggestions: MealCache['suggestions']) {
  await commitMeals(scope, async (tx, account) => {
    const { cache } = await readMeals(tx, account);
    cache.suggestions = suggestions;
    await putMeals(tx, cache);
  });
}

async function queueMealChange(
  build: (
    cache: MealCache,
    operations: MealOperation[],
    tx: IDBTransaction,
  ) => Promise<MealOfflineChange> | MealOfflineChange,
) {
  const scope = mealStore.accountScope();
  if (!session || session.role === 'child' || !mealStore.snapshot().view || !scope.current())
    throw new Error('Pamięć obiadów nie jest gotowa lub nie masz uprawnień do zapisu.');
  return commitMeals(scope, async (tx, account) => {
    const saved = await readMeals(tx, account);
    const projected = projectMeals(saved.cache, saved.operations);
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
    if (change.type === 'export') await projectQueuedMealExport(tx, account);
    return { ...change, operationId };
  });
}
export function queueMeal(date: string, data: PutMeal | null, id: string | null) {
  return queueMealChange((cache) => {
    const weekStart = mealWeekStart(date);
    const week = cache.weeks[weekStart];
    if (!week) throw new Error('Ten tydzień nie został pobrany. Połącz się z internetem.');
    if (id && !week.data.days.find((day) => day.date === date)?.meals.some((meal) => meal.id === id))
      throw new Error('Tego dania nie ma już w planie.');
    return {
      type: 'write',
      weekStart,
      byId: true,
      writes: [{ date, id: id ?? crypto.randomUUID(), expectedId: id, data }],
    };
  });
}
export function queueMealCopy(weekStart: string, overwrite: boolean) {
  return queueMealChange((cache) => {
    const source = cache.weeks[shiftMealDate(weekStart, -7)];
    const target = cache.weeks[weekStart];
    if (!source || !target) throw new Error('Najpierw pobierz tydzień źródłowy i docelowy.');
    const expectedDays: Record<string, string[]> = {};
    const writes = source.data.days.flatMap(({ meals }, index) => {
      const { date, meals: previous } = target.data.days[index]!;
      if (!meals.length || (!overwrite && previous.length)) return [];
      expectedDays[date] = previous.map((meal) => meal.id);
      const copies = meals.map(({ title, notes, ingredients }, position) => ({
        date,
        id: previous[position]?.id ?? crypto.randomUUID(),
        expectedId: previous[position]?.id ?? null,
        data: { title, notes, ingredients },
      }));
      const removals = previous.slice(meals.length).map(({ id }) => ({ date, id, expectedId: id, data: null }));
      return [...copies, ...removals];
    });
    return { type: 'write', weekStart, byId: true, expectedDays, writes };
  });
}
export async function queueMealExport(weekStart: string, listId: string, mealIds: string[], confirmRepeat: boolean) {
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
    const targets = await resolveMealExportTargets(
      tx,
      cache.account,
      listId,
      meals.flatMap((meal) => meal.ingredients),
    );
    return {
      type: 'export',
      data: {
        weekStart,
        listId,
        mealIds,
        confirmRepeat,
        snapshot: meals.map((meal) => ({ mealId: meal.id, date: meal.date, ingredients: meal.ingredients })),
        targets,
      },
    };
  });
}
export async function confirmMealExport(operationId: string) {
  await commitMeals(mealStore.accountScope(), async (tx, account) => {
    const operations = await readOperations(tx, account);
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
    notifyOutboxChanged(tx, account);
  });
}
export async function discardMealOperation(operationId: string) {
  await commitMeals(mealStore.accountScope(), async (tx, account) => {
    const operations = await readOperations(tx, account);
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
        tx.objectStore('outbox').delete([account, op.operationId]);
      }
    }
    await recountOutboxBudgets(tx, account);
    notifyOutboxChanged(tx, account);
  });
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
