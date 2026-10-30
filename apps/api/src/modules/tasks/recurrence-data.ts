import { eq, inArray, sql } from 'drizzle-orm';
import type { DatabaseConnection } from '../../db/client.js';
import { taskOccurrences, taskSeries } from '../../db/schema.js';

export function taskRecurrenceMany(database: DatabaseConnection, ids: string[]) {
  const result = new Map<string, typeof taskOccurrences.$inferSelect & { seriesVersion: number }>();
  for (let offset = 0; offset < ids.length; offset += 400)
    for (const row of database.db
      .select({ occurrence: taskOccurrences, seriesVersion: taskSeries.version })
      .from(taskOccurrences)
      .innerJoin(taskSeries, eq(taskSeries.id, taskOccurrences.seriesId))
      .where(inArray(taskOccurrences.taskId, ids.slice(offset, offset + 400)))
      .all())
      result.set(row.occurrence.taskId, { ...row.occurrence, seriesVersion: row.seriesVersion });
  return result;
}

export function bumpTaskOccurrence(database: DatabaseConnection, taskId: string) {
  database.db
    .update(taskOccurrences)
    .set({ version: sql`${taskOccurrences.version} + 1` })
    .where(eq(taskOccurrences.taskId, taskId))
    .run();
}
