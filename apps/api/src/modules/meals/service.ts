import {
  mergeQuantities,
  normalizeShoppingName,
  type CopyMealWeek,
  type PutMeal,
  type MealsToShoppingList,
} from '@rodzina/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { DatabaseConnection } from '../../db/client.js';
import type { FamilyRole } from '../../permissions.js';
import { ApiError } from '../../http/errors.js';
import { createMealRepository } from './repository.js';
import { createShoppingService } from '../shopping/service.js';
import { mealShoppingExports } from '../../db/schema.js';

// Calendar dates are floating days, so DST must not affect week offsets.
function day(start: string, offset: number) {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
export function createMealService(database: DatabaseConnection) {
  const repository = createMealRepository(database);
  const shopping = createShoppingService(database);
  function requireAdult(role: FamilyRole) {
    if (role === 'child') throw new ApiError(403, 'FORBIDDEN', 'Ta czynność jest dostępna tylko dla dorosłych.');
  }
  function requireExportAccess(familyId: string, role: FamilyRole, listId: string) {
    requireAdult(role);
    // This also runs before replaying a saved response, even if the list has been deleted.
    return shopping.listItems(familyId, listId);
  }
  return {
    requireExportAccess,
    toShoppingList(familyId: string, actorId: string, role: FamilyRole, data: MealsToShoppingList) {
      return database.db.transaction(
        () => {
          const items = requireExportAccess(familyId, role, data.listId);
          const available = repository.week(familyId, data.weekStart, day(data.weekStart, 6));
          if (data.mealIds?.some((id) => !available.some((meal) => meal.id === id)))
            throw new ApiError(404, 'NOT_FOUND', 'Wybrany obiad nie istnieje w tym tygodniu.');
          const selected = available.filter((meal) => !data.mealIds || data.mealIds.includes(meal.id));
          const ids = selected.map((meal) => meal.id);
          const previous = ids.length
            ? database.db
                .select()
                .from(mealShoppingExports)
                .where(and(eq(mealShoppingExports.listId, data.listId), inArray(mealShoppingExports.mealId, ids)))
                .get()
            : undefined;
          if (previous && !data.confirmRepeat)
            throw new ApiError(
              409,
              'MEAL_EXPORT_CONFIRMATION_REQUIRED',
              'Wybrane obiady były już eksportowane na tę listę. Potwierdź, aby ponownie dodać ich ilości.',
            );
          const grouped = new Map<string, { name: string; quantity: string | null }>();
          for (const meal of selected)
            for (const ingredient of meal.ingredients) {
              const key = normalizeShoppingName(ingredient.name);
              const entry = grouped.get(key);
              grouped.set(key, {
                name: entry?.name ?? ingredient.name,
                quantity: mergeQuantities(entry?.quantity, ingredient.quantity),
              });
            }
          let added = 0;
          let updated = 0;
          for (const [key, ingredient] of grouped) {
            // Checked purchases describe past needs and must not absorb new ingredients.
            const existing = items.find((item) => !item.isChecked && normalizeShoppingName(item.name) === key);
            if (existing) {
              shopping.updateItem(familyId, existing.id, actorId, role, {
                quantity: mergeQuantities(existing.quantity, ingredient.quantity),
              });
              updated++;
            } else {
              shopping.createItem(familyId, data.listId, actorId, ingredient);
              added++;
            }
          }
          if (ids.length)
            database.db
              .insert(mealShoppingExports)
              .values(
                ids.map((mealId) => ({
                  mealId,
                  listId: data.listId,
                  createdAt: Date.now(),
                })),
              )
              .onConflictDoNothing()
              .run();
          return { added, updated };
        },
        { behavior: 'immediate' },
      );
    },
    week(familyId: string, weekStart: string) {
      return database.db.transaction(() => {
        const meals = repository.week(familyId, weekStart, day(weekStart, 6));
        return {
          weekStart,
          days: Array.from({ length: 7 }, (_, offset) => {
            const date = day(weekStart, offset);
            return { date, meals: meals.filter((meal) => meal.date === date) };
          }),
        };
      });
    },
    put(familyId: string, actorId: string, role: FamilyRole, date: string, data: PutMeal) {
      requireAdult(role);
      return database.db.transaction(() => repository.put(familyId, actorId, date, data));
    },
    remove(familyId: string, role: FamilyRole, date: string) {
      requireAdult(role);
      if (!repository.remove(familyId, date)) throw new ApiError(404, 'NOT_FOUND', 'Obiad nie istnieje.');
    },
    copy(familyId: string, actorId: string, role: FamilyRole, data: CopyMealWeek) {
      requireAdult(role);
      return database.db.transaction(() => {
        const source = repository.week(familyId, data.fromWeekStart, day(data.fromWeekStart, 6));
        const target = repository.week(familyId, data.toWeekStart, day(data.toWeekStart, 6));
        let copied = 0;
        for (const meal of source) {
          const offset = Math.round(
            (Date.parse(`${meal.date}T00:00:00Z`) - Date.parse(`${data.fromWeekStart}T00:00:00Z`)) / 86400000,
          );
          const date = day(data.toWeekStart, offset);
          if (!data.overwrite && target.some((item) => item.date === date)) continue;
          repository.put(familyId, actorId, date, meal);
          copied++;
        }
        return copied;
      });
    },
    suggestions(familyId: string, query: string) {
      return database.db.transaction(() => repository.suggestions(familyId, query));
    },
  };
}
