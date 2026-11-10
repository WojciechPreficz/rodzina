import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { ApiError } from '../../http/errors.js';
import type { Meal, PutMeal } from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { mealIngredients, meals, mealShoppingExports } from '../../db/schema.js';

export function createMealRepository(database: DatabaseConnection) {
  const db = database.db;
  const order = [asc(meals.createdAt), asc(sql`${meals}.rowid`)] as const;
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
  const familyMeals = (familyId: string) => db.select({ id: meals.id }).from(meals).where(eq(meals.familyId, familyId));
  return {
    idIsTaken: (id: string) => !!db.select({ id: meals.id }).from(meals).where(eq(meals.id, id)).get(),
    hasExports(familyId: string, listId: string, ids: string[]) {
      return (
        ids.length > 0 &&
        !!db
          .select({ mealId: mealShoppingExports.mealId })
          .from(mealShoppingExports)
          .innerJoin(meals, eq(meals.id, mealShoppingExports.mealId))
          .where(
            and(
              eq(meals.familyId, familyId),
              eq(mealShoppingExports.listId, listId),
              inArray(mealShoppingExports.mealId, ids),
            ),
          )
          .get()
      );
    },
    recordExports(listId: string, ids: string[], createdAt: number) {
      if (ids.length)
        db.insert(mealShoppingExports)
          .values(ids.map((mealId) => ({ mealId, listId, createdAt })))
          .onConflictDoNothing()
          .run();
    },
    firstId(familyId: string, date: string) {
      return db
        .select({ id: meals.id })
        .from(meals)
        .where(and(eq(meals.familyId, familyId), eq(meals.date, date)))
        .orderBy(...order)
        .get()?.id;
    },
    week(familyId: string, start: string, end: string) {
      return hydrate(
        db
          .select()
          .from(meals)
          .where(and(eq(meals.familyId, familyId), gte(meals.date, start), lte(meals.date, end)))
          .orderBy(asc(meals.date), ...order)
          .all(),
      );
    },
    put(familyId: string, actorId: string, date: string, data: PutMeal, id?: string) {
      const existing =
        id &&
        db
          .select({ id: meals.id })
          .from(meals)
          .where(and(eq(meals.id, id), eq(meals.familyId, familyId)))
          .get();
      if (!existing) database.familyRecordLimits.requireCapacity('meals', familyId);
      const now = Date.now();
      const row = db
        .insert(meals)
        .values({
          id: id ?? randomUUID(),
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
          target: meals.id,
          setWhere: eq(meals.familyId, familyId),
          set: { title: data.title, notes: data.notes || null, updatedAt: now },
        })
        .returning()
        .get();
      if (!row) throw new ApiError(409, 'MEAL_CONFLICT', 'Identyfikator obiadu jest już używany.');
      db.delete(mealIngredients)
        .where(and(eq(mealIngredients.mealId, row.id), inArray(mealIngredients.mealId, familyMeals(familyId))))
        .run();
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
    remove(familyId: string, id: string) {
      return db
        .delete(meals)
        .where(and(eq(meals.familyId, familyId), eq(meals.id, id)))
        .returning({ id: meals.id })
        .get();
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
