import { z } from 'zod';
import { mealWeekResponseSchema, mealSuggestionsResponseSchema, mealOfflineChangeSchema } from '@rodzina/shared';
import { makeEntry, readAccountCache } from '../../offline/database.js';
import { chargedBytes, type CacheEntry, type OfflineAdapter } from '../../offline/registry.js';
import { readOperations, type Operation } from '../../offline/outbox.js';
import { shiftMealDate } from './mealDates.js';

export const mealCacheSchema = z
  .object({
    account: z.string(),
    weeks: z.record(z.string(), z.object({ data: mealWeekResponseSchema, syncedAt: z.number() })),
    suggestions: mealSuggestionsResponseSchema.shape.suggestions,
    exports: z.record(z.string(), z.array(z.string())),
    results: z.record(z.string(), z.object({ added: z.number(), updated: z.number() })).default({}),
  })
  .superRefine((cache, context) => {
    for (const [weekStart, week] of Object.entries(cache.weeks)) {
      if (
        week.data.weekStart !== weekStart ||
        week.data.days.some(
          (day, index) =>
            day.date !== shiftMealDate(weekStart, index) ||
            new Set(day.meals.map((meal) => meal.id)).size !== day.meals.length ||
            day.meals.some((meal) => meal.familyId !== cache.account.split(':')[0] || meal.date !== day.date),
        )
      )
        context.addIssue({ code: 'custom', message: 'Nieprawidłowy zakres lub rodzina zapisanych obiadów.' });
    }
  });
export type MealCache = z.infer<typeof mealCacheSchema>;
export type MealOperation = Operation & { payload: z.infer<typeof mealOfflineChangeSchema> };
export const emptyMeals = (account: string): MealCache => ({
  account,
  weeks: {},
  suggestions: [],
  exports: {},
  results: {},
});
export const mealCache = {
  module: 'meals',
  schemaVersion: 1,
  separateMigration: true,
  legacyKey: 'rodzina:meals:v1',
  budget: 4 * 1048576,
  parseCache: (value) => mealCacheSchema.parse(value),
  // Pending bases must never be evicted. Refuse a write if the cache is full.
  trim: (value) => value,
  describe: (value) => ({
    coverage: Object.keys((value as MealCache).weeks).length ? 'partial' : 'missing',
    syncedAt: Math.max(0, ...Object.values((value as MealCache).weeks).map((week) => week.syncedAt)) || null,
  }),
} satisfies Omit<OfflineAdapter, 'capabilities'>;

export async function readMeals(tx: IDBTransaction, account: string) {
  const entry = await readAccountCache(tx, 'meals', account);
  if (entry && entry.schemaVersion !== 1)
    throw new Error('Nieobsługiwana wersja pamięci obiadów. Zaktualizuj aplikację.');
  const cache = entry ? mealCacheSchema.parse(entry.payload) : emptyMeals(account);
  if (cache.account !== account) throw new DOMException('Session changed', 'AbortError');
  return { cache, operations: await readMealChanges(tx, account) };
}

export async function readMealChanges(tx: IDBTransaction, account: string) {
  return (await readOperations(tx, account))
    .filter((op) => op.module === 'meals')
    .map((op) => ({
      ...op,
      payload: mealOfflineChangeSchema.parse(op.payload),
    }));
}
export async function putMeals(tx: IDBTransaction, cache: MealCache) {
  mealCacheSchema.parse(cache);
  const operations = (await readOperations(tx, cache.account)).filter((op) => op.module === 'meals');
  const pinned = new Set(
    operations.map((op) => {
      const change = mealOfflineChangeSchema.parse(op.payload);
      return change.type === 'write' ? change.weekStart : change.data.weekStart;
    }),
  );
  const queueBytes = operations.reduce((sum, op) => sum + chargedBytes([cache.account, op.operationId], op), 0);
  let entry: CacheEntry;
  for (;;) {
    try {
      entry = makeEntry('meals', cache);
      if (operations.length && entry.chargedBytes + queueBytes > 6 * 1048576)
        throw new Error('Brak miejsca na zapis obiadów i kolejki zmian.');
      break;
    } catch (error) {
      const evict = Object.entries(cache.weeks)
        .filter(([week]) => !pinned.has(week))
        .sort(([, a], [, b]) => a.syncedAt - b.syncedAt)[0];
      if (!evict) throw error;
      delete cache.weeks[evict[0]];
    }
  }
  tx.objectStore('cache').put(entry);
  tx.objectStore('metadata').put({
    accountId: cache.account,
    key: 'budget:meals',
    value: entry.chargedBytes + queueBytes,
  });
}
export function projectMeals(cache: MealCache, operations: readonly MealOperation[]) {
  const [familyId, userId] = cache.account.split(':');
  const result = structuredClone(cache);
  for (const operation of operations) {
    if (operation.status === 'needs-review' || operation.payload.type !== 'write') continue;
    const { weekStart, writes, byId, expectedDays } = operation.payload;
    const week = result.weeks[weekStart];
    if (!week) continue;
    if (
      expectedDays &&
      week.data.days.some(({ date, meals }) => {
        const expected = expectedDays[date];
        return (
          expected && (meals.length !== expected.length || meals.some((meal, index) => meal.id !== expected[index]))
        );
      })
    )
      continue;
    for (const write of writes) {
      const day = week.data.days.find((day) => day.date === write.date);
      if (!day) continue;
      const index = byId ? day.meals.findIndex((meal) => meal.id === write.id) : day.meals.length ? 0 : -1;
      const previous = day.meals[index];
      if ((previous?.id ?? null) !== write.expectedId || (previous && previous.id !== write.id)) continue;
      if (!write.data) {
        if (previous) day.meals.splice(index, 1);
        continue;
      }
      const meal: (typeof day.meals)[number] = {
        ...write.data,
        id: write.id,
        familyId: familyId!,
        date: write.date,
        slot: 'dinner',
        notes: write.data.notes ?? null,
        ingredients: write.data.ingredients.map((item) => ({ ...item, quantity: item.quantity ?? null })),
        createdBy: previous ? previous.createdBy : userId!,
        createdAt: previous?.createdAt ?? operation.submittedAt,
        updatedAt: operation.submittedAt,
      };
      if (previous) day.meals[index] = meal;
      else day.meals.push(meal);
    }
  }
  return result;
}
