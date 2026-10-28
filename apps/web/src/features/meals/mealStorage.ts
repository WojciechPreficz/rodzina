import { z } from 'zod';
import { mealWeekResponseSchema, mealSuggestionsResponseSchema, mealOfflineChangeSchema } from '@rodzina/shared';
import { assertContext, makeEntry, requestValue } from '../../offline/database.js';
import { registerAdapter, chargedBytes, type CacheEntry } from '../../offline/registry.js';
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
            day.meals.length > 1 ||
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
registerAdapter({
  module: 'meals',
  schemaVersion: 1,
  capabilities: 'read-write',
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
});
export async function readMeals(tx: IDBTransaction, account: string) {
  const active = await assertContext(tx);
  if (active.accountId !== account) throw new DOMException('Session changed', 'AbortError');
  const entry = await requestValue<CacheEntry | undefined>(tx.objectStore('cache').get([account, 'meals', 'snapshot']));
  if (entry && entry.schemaVersion !== 1)
    throw new Error('Nieobsługiwana wersja pamięci obiadów. Zaktualizuj aplikację.');
  const cache = entry ? mealCacheSchema.parse(entry.payload) : emptyMeals(account);
  if (cache.account !== account) throw new DOMException('Session changed', 'AbortError');
  const operations = (await readOperations(tx, account))
    .filter((op) => op.module === 'meals')
    .map((op) => ({
      ...op,
      payload: mealOfflineChangeSchema.parse(op.payload),
    }));
  return { cache, operations };
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
export function projectMeals(cache: MealCache, operations: MealOperation[], userId: string) {
  const result = structuredClone(cache);
  for (const operation of operations) {
    if (operation.status === 'needs-review' || operation.payload.type !== 'write') continue;
    const { weekStart, writes } = operation.payload;
    const week = result.weeks[weekStart];
    if (!week) continue;
    for (const write of writes) {
      const day = week.data.days.find((day) => day.date === write.date);
      if (!day) continue;
      const previous = day.meals[0];
      day.meals = write.data
        ? [
            {
              ...write.data,
              id: write.id,
              familyId: cache.account.split(':')[0]!,
              date: write.date,
              slot: 'dinner',
              notes: write.data.notes ?? null,
              ingredients: write.data.ingredients.map((item) => ({ ...item, quantity: item.quantity ?? null })),
              createdBy: previous?.createdBy ?? userId,
              createdAt: previous?.createdAt ?? operation.submittedAt,
              updatedAt: operation.submittedAt,
            },
          ]
        : [];
    }
  }
  return result;
}
