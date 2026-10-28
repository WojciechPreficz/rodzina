import type { CopyMealWeek, PutMeal } from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import type { FamilyRole } from '../../permissions.js';
import { ApiError } from '../../http/errors.js';
import { createMealRepository } from './repository.js';

// Calendar dates are floating days, so DST must not affect week offsets.
function day(start: string, offset: number) {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
export function createMealService(database: DatabaseConnection) {
  const repository = createMealRepository(database);
  function requireAdult(role: FamilyRole) {
    if (role === 'child') throw new ApiError(403, 'FORBIDDEN', 'Ta czynność jest dostępna tylko dla dorosłych.');
  }
  return {
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
