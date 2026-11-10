import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DatabaseConnection } from '../../db/client.js';
import { taskOccurrences, taskSeries, taskSeriesHistory, tasks, taskLists } from '../../db/schema.js';

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

export function bumpTaskOccurrence(database: DatabaseConnection, familyId: string, taskId: string) {
  database.db
    .update(taskOccurrences)
    .set({ version: sql`${taskOccurrences.version} + 1` })
    .where(
      and(
        eq(taskOccurrences.taskId, taskId),
        inArray(
          taskOccurrences.taskId,
          database.db
            .select({ id: tasks.id })
            .from(tasks)
            .innerJoin(taskLists, eq(taskLists.id, tasks.listId))
            .where(and(eq(tasks.id, taskId), eq(taskLists.familyId, familyId))),
        ),
      ),
    )
    .run();
}

export function createTaskRecurrenceRepository(database: DatabaseConnection) {
  const db = database.db;
  const listIds = (familyId: string) =>
    db.select({ id: taskLists.id }).from(taskLists).where(eq(taskLists.familyId, familyId));
  const seriesScope = (familyId: string, id: string) =>
    and(eq(taskSeries.id, id), inArray(taskSeries.listId, listIds(familyId)));
  const occurrenceScope = (familyId: string, taskId: string) =>
    and(eq(taskOccurrences.taskId, taskId), inArray(taskOccurrences.listId, listIds(familyId)));
  const openHistory = (seriesId: string) =>
    and(eq(taskSeriesHistory.seriesId, seriesId), isNull(taskSeriesHistory.undoneAt));

  return {
    findSeries: (familyId: string, id: string) => db.select().from(taskSeries).where(seriesScope(familyId, id)).get(),
    findTask: (familyId: string, id: string) =>
      db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, id), inArray(tasks.listId, listIds(familyId))))
        .get(),
    findActive: (seriesId: string) =>
      db
        .select()
        .from(taskOccurrences)
        .where(and(eq(taskOccurrences.seriesId, seriesId), eq(taskOccurrences.state, 'active')))
        .get(),
    lastClosure: (seriesId: string) =>
      db.select().from(taskSeriesHistory).where(openHistory(seriesId)).orderBy(desc(taskSeriesHistory.sequence)).get(),
    findClosure: (seriesId: string, sequence: number) =>
      db
        .select()
        .from(taskSeriesHistory)
        .where(and(openHistory(seriesId), eq(taskSeriesHistory.sequence, sequence)))
        .get(),
    listHistory: (seriesId: string) =>
      db
        .select()
        .from(taskSeriesHistory)
        .where(eq(taskSeriesHistory.seriesId, seriesId))
        .orderBy(asc(taskSeriesHistory.sequence), asc(taskSeriesHistory.closedAt))
        .all(),
    insertOccurrence: (values: typeof taskOccurrences.$inferInsert) => db.insert(taskOccurrences).values(values).run(),
    insertSeries: (values: typeof taskSeries.$inferInsert) => db.insert(taskSeries).values(values).run(),
    insertClosure: (values: typeof taskSeriesHistory.$inferInsert) => db.insert(taskSeriesHistory).values(values).run(),
    updateOccurrence(familyId: string, taskId: string, values: Partial<typeof taskOccurrences.$inferInsert>) {
      db.update(taskOccurrences).set(values).where(occurrenceScope(familyId, taskId)).run();
    },
    removeOccurrence(familyId: string, taskId: string) {
      db.delete(taskOccurrences).where(occurrenceScope(familyId, taskId)).run();
    },
    updateSeries(familyId: string, id: string, values: Partial<typeof taskSeries.$inferInsert>) {
      db.update(taskSeries).set(values).where(seriesScope(familyId, id)).run();
    },
    undoClosure(familyId: string, seriesId: string, id: string, undoneAt: number, undoneBy: string) {
      const seriesIds = db.select({ id: taskSeries.id }).from(taskSeries).where(seriesScope(familyId, seriesId));
      db.update(taskSeriesHistory)
        .set({ undoneAt, undoneBy })
        .where(and(eq(taskSeriesHistory.id, id), inArray(taskSeriesHistory.seriesId, seriesIds)))
        .run();
    },
    completeTask(familyId: string, taskId: string, doneAt: number | null, doneBy: string | null) {
      db.update(tasks)
        .set({ isDone: true, doneAt, doneBy })
        .where(and(eq(tasks.id, taskId), inArray(tasks.listId, listIds(familyId))))
        .run();
    },
  };
}
