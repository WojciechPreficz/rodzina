import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import type { Meal, PutMeal } from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { mealIngredients, meals } from '../../db/schema.js';

export function createMealRepository(database: DatabaseConnection) {
  const db = database.db;
  const scope = (familyId: string, date: string) =>
    and(eq(meals.familyId, familyId), eq(meals.date, date), eq(meals.slot, 'dinner'));
  function hydrate(rows: (typeof meals.$inferSelect)[]): Meal[] {
    if (!rows.length) return [];
    const ingredients = db
      .select()
      .from(mealIngredients)
      .where(
        inArray(
          mealIngredients.mealId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(mealIngredients.position))
      .all();
    const grouped = new Map<string, Meal['ingredients']>();
    for (const { mealId, name, quantity } of ingredients) {
      const list = grouped.get(mealId) ?? [];
      list.push({ name, quantity });
      grouped.set(mealId, list);
    }
    return rows.map((row) => ({ ...row, ingredients: grouped.get(row.id) ?? [] }));
  }
  return {
    week(familyId: string, start: string, end: string) {
      return hydrate(
        db
          .select()
          .from(meals)
          .where(and(eq(meals.familyId, familyId), gte(meals.date, start), lte(meals.date, end)))
          .orderBy(asc(meals.date))
          .all(),
      );
    },
    put(familyId: string, actorId: string, date: string, data: PutMeal) {
      const now = Date.now();
      const row = db
        .insert(meals)
        .values({
          id: randomUUID(),
          familyId,
          date,
          slot: 'dinner',
          title: data.title,
          notes: data.notes || null,
          createdBy: actorId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [meals.familyId, meals.date, meals.slot],
          set: { title: data.title, notes: data.notes || null, updatedAt: now },
        })
        .returning()
        .get();
      db.delete(mealIngredients).where(eq(mealIngredients.mealId, row.id)).run();
      if (data.ingredients.length)
        db.insert(mealIngredients)
          .values(
            data.ingredients.map((item, position) => ({
              id: randomUUID(),
              mealId: row.id,
              name: item.name,
              quantity: item.quantity || null,
              position,
            })),
          )
          .run();
      return hydrate([row])[0]!;
    },
    remove(familyId: string, date: string) {
      return db.delete(meals).where(scope(familyId, date)).returning({ id: meals.id }).get();
    },
    suggestions(familyId: string, query: string) {
      const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('pl').replace(/\s+/g, ' ').trim();
      const search = normalize(query);
      const seen = new Set<string>();
      const selected: (typeof meals.$inferSelect)[] = [];
      const rows = db
        .select()
        .from(meals)
        .where(eq(meals.familyId, familyId))
        .orderBy(desc(meals.updatedAt), desc(meals.date), asc(meals.id))
        .all();
      for (const row of rows) {
        const key = normalize(row.title);
        if (!key.includes(search) || seen.has(key)) continue;
        seen.add(key);
        selected.push(row);
        if (selected.length === 20) break;
      }
      return hydrate(selected).map(({ title, ingredients }) => ({ title, ingredients }));
    },
  };
}
