import crypto from 'node:crypto';
import { and, asc, eq, ne } from 'drizzle-orm';
import {
  computeNextFireAt,
  type Reminder,
  type SharedEventReminder,
  type SharedTaskReminder,
  type SharedDocumentReminder,
  type Task,
  type TimeEvent,
  type TimeReminder,
  type TimeException,
} from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { reminders } from '../../db/schema.js';

export function createReminderRepository(database: DatabaseConnection) {
  const db = database.db;
  function list(familyId: string, eventId: string, userId?: string): Reminder[] {
    return db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.familyId, familyId),
          eq(reminders.eventId, eventId),
          userId === undefined
            ? ne(reminders.audience, 'user')
            : and(eq(reminders.audience, 'user'), eq(reminders.userId, userId)),
        ),
      )
      .orderBy(asc(reminders.id))
      .all();
  }
  function insert(
    familyId: string,
    event: TimeEvent & { exceptions?: readonly TimeException[] },
    actorId: string,
    data: TimeReminder,
    audience: Reminder['audience'],
    tz: string,
    now: number,
    userId: string | null = null,
  ) {
    const row: Reminder = {
      id: crypto.randomUUID(),
      familyId,
      eventId: event.id,
      taskId: null,
      documentId: null,
      type: data.type,
      offsetValue: data.type === 'offset' ? data.offsetValue : null,
      offsetUnit: data.type === 'offset' ? data.offsetUnit : null,
      remindAt: data.type === 'absolute' ? data.remindAt : null,
      audience,
      userId,
      createdBy: actorId,
      nextFireAt: computeNextFireAt(data, event, now, tz),
      lastSentAt: null,
    };
    db.insert(reminders).values(row).run();
    return row;
  }
  function saveEvent(
    familyId: string,
    event: TimeEvent & { exceptions?: readonly TimeException[] },
    actorId: string,
    shared: SharedEventReminder[] | undefined,
    tz: string,
    now: number,
  ) {
    if (shared !== undefined) {
      db.delete(reminders)
        .where(and(eq(reminders.familyId, familyId), eq(reminders.eventId, event.id), ne(reminders.audience, 'user')))
        .run();
      for (const data of shared) insert(familyId, event, actorId, data, data.audience, tz, now);
    }
    const rows = db
      .select()
      .from(reminders)
      .where(and(eq(reminders.familyId, familyId), eq(reminders.eventId, event.id)))
      .all();
    for (const row of rows) {
      const data: TimeReminder =
        row.type === 'offset'
          ? { type: 'offset', offsetValue: row.offsetValue!, offsetUnit: row.offsetUnit! }
          : { type: 'absolute', remindAt: row.remindAt! };
      db.update(reminders)
        .set({ nextFireAt: computeNextFireAt(data, event, now, tz) })
        .where(eq(reminders.id, row.id))
        .run();
    }
  }
  function removeMine(familyId: string, userId: string, id: string) {
    return (
      db
        .delete(reminders)
        .where(
          and(
            eq(reminders.familyId, familyId),
            eq(reminders.userId, userId),
            eq(reminders.audience, 'user'),
            eq(reminders.id, id),
          ),
        )
        .run().changes > 0
    );
  }
  function listTask(familyId: string, taskId: string, userId?: string): Reminder[] {
    return db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.familyId, familyId),
          eq(reminders.taskId, taskId),
          userId === undefined
            ? ne(reminders.audience, 'user')
            : and(eq(reminders.audience, 'user'), eq(reminders.userId, userId)),
        ),
      )
      .orderBy(asc(reminders.id))
      .all();
  }
  function taskTime(task: Pick<Task, 'dueDate' | 'dueTime' | 'isDone'>) {
    return { date: task.dueDate, time: task.dueTime, completed: task.isDone };
  }
  function insertTask(
    familyId: string,
    task: Task,
    actorId: string,
    data: TimeReminder,
    audience: Reminder['audience'],
    tz: string,
    now: number,
    userId: string | null = null,
  ) {
    const row: Reminder = {
      id: crypto.randomUUID(),
      familyId,
      eventId: null,
      taskId: task.id,
      documentId: null,
      type: data.type,
      offsetValue: data.type === 'offset' ? data.offsetValue : null,
      offsetUnit: data.type === 'offset' ? data.offsetUnit : null,
      remindAt: data.type === 'absolute' ? data.remindAt : null,
      audience,
      userId,
      createdBy: actorId,
      nextFireAt: task.dueDate ? computeNextFireAt(data, taskTime(task), now, tz) : null,
      lastSentAt: null,
    };
    db.insert(reminders).values(row).run();
    return row;
  }
  function saveTask(
    familyId: string,
    task: Task,
    actorId: string,
    shared: SharedTaskReminder[] | undefined,
    tz: string,
    now: number,
  ) {
    if (shared !== undefined) {
      db.delete(reminders)
        .where(and(eq(reminders.familyId, familyId), eq(reminders.taskId, task.id), ne(reminders.audience, 'user')))
        .run();
      for (const data of shared) insertTask(familyId, task, actorId, data, data.audience, tz, now);
    }
    for (const row of db
      .select()
      .from(reminders)
      .where(and(eq(reminders.familyId, familyId), eq(reminders.taskId, task.id)))
      .all()) {
      const data: TimeReminder =
        row.type === 'offset'
          ? { type: 'offset', offsetValue: row.offsetValue!, offsetUnit: row.offsetUnit! }
          : { type: 'absolute', remindAt: row.remindAt! };
      db.update(reminders)
        .set({ nextFireAt: task.dueDate ? computeNextFireAt(data, taskTime(task), now, tz) : null })
        .where(eq(reminders.id, row.id))
        .run();
    }
  }
  function listDocument(familyId: string, documentId: string, userId?: string): Reminder[] {
    return db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.familyId, familyId),
          eq(reminders.documentId, documentId),
          userId === undefined
            ? ne(reminders.audience, 'user')
            : and(eq(reminders.audience, 'user'), eq(reminders.userId, userId)),
        ),
      )
      .orderBy(asc(reminders.id))
      .all();
  }
  function insertDocument(
    familyId: string,
    document: { id: string; expiresOn: string },
    actorId: string,
    data: TimeReminder,
    audience: Reminder['audience'],
    tz: string,
    now: number,
    userId: string | null = null,
  ) {
    const row: Reminder = {
      id: crypto.randomUUID(),
      familyId,
      eventId: null,
      taskId: null,
      documentId: document.id,
      type: data.type,
      offsetValue: data.type === 'offset' ? data.offsetValue : null,
      offsetUnit: data.type === 'offset' ? data.offsetUnit : null,
      remindAt: data.type === 'absolute' ? data.remindAt : null,
      audience,
      userId,
      createdBy: actorId,
      nextFireAt: computeNextFireAt(data, { date: document.expiresOn }, now, tz),
      lastSentAt: null,
    };
    db.insert(reminders).values(row).run();
    return row;
  }
  function saveDocument(
    familyId: string,
    document: { id: string; expiresOn: string },
    actorId: string,
    shared: SharedDocumentReminder[] | undefined,
    tz: string,
    now: number,
  ) {
    const scope = and(eq(reminders.familyId, familyId), eq(reminders.documentId, document.id));
    if (shared !== undefined) {
      db.delete(reminders)
        .where(and(scope, ne(reminders.audience, 'user')))
        .run();
      for (const data of shared) insertDocument(familyId, document, actorId, data, data.audience, tz, now);
    }
    for (const row of db.select().from(reminders).where(scope).all()) {
      const data: TimeReminder =
        row.type === 'offset'
          ? { type: 'offset', offsetValue: row.offsetValue!, offsetUnit: row.offsetUnit! }
          : { type: 'absolute', remindAt: row.remindAt! };
      db.update(reminders)
        .set({ nextFireAt: computeNextFireAt(data, { date: document.expiresOn }, now, tz) })
        .where(eq(reminders.id, row.id))
        .run();
    }
  }
  return {
    list,
    insert,
    saveEvent,
    removeMine,
    listTask,
    insertTask,
    saveTask,
    taskTime,
    listDocument,
    insertDocument,
    saveDocument,
  };
}
