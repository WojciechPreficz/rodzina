import crypto from 'node:crypto';
import { and, asc, count, eq, inArray, lte, max, or, sql } from 'drizzle-orm';
import type { CreateTask, PatchTask, TaskStatus } from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { families, taskListMembers, taskLists, tasks, users } from '../../db/schema.js';
import { createReminderRepository } from '../reminders/repository.js';

export function createTaskListRepository(database: DatabaseConnection) {
  const db = database.db;
  const reminderRepository = createReminderRepository(database);
  function serializeTask(task: typeof tasks.$inferSelect) {
    const familyId = db
      .select({ familyId: taskLists.familyId })
      .from(taskLists)
      .where(eq(taskLists.id, task.listId))
      .get()!.familyId;
    return { ...task, reminders: reminderRepository.listTask(familyId, task.id) };
  }
  const accessFilter = (familyId: string, actorId: string) =>
    and(
      eq(taskLists.familyId, familyId),
      or(
        eq(taskLists.ownerId, actorId),
        inArray(
          taskLists.id,
          db.select({ id: taskListMembers.listId }).from(taskListMembers).where(eq(taskListMembers.userId, actorId)),
        ),
      ),
    );
  function members(listId: string) {
    return db
      .select({ userId: users.id })
      .from(taskListMembers)
      .innerJoin(users, eq(users.id, taskListMembers.userId))
      .where(eq(taskListMembers.listId, listId))
      .orderBy(asc(users.createdAt), asc(users.id))
      .all()
      .map((row) => row.userId);
  }
  function serialize(list: typeof taskLists.$inferSelect) {
    const openTaskCount = db
      .select({ value: count() })
      .from(tasks)
      .where(and(eq(tasks.listId, list.id), eq(tasks.isDone, false)))
      .get()!.value;
    return { ...list, memberIds: members(list.id), openTaskCount };
  }
  function findAccessibleList(familyId: string, actorId: string, id: string) {
    const list = db
      .select()
      .from(taskLists)
      .where(and(eq(taskLists.id, id), accessFilter(familyId, actorId)))
      .get();
    return list ? serialize(list) : undefined;
  }
  function ensureDefault(familyId: string, actorId: string) {
    const now = Date.now();
    db.insert(taskLists)
      .values({
        id: crypto.randomUUID(),
        familyId,
        ownerId: actorId,
        name: 'Moje zadania',
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .run();
  }
  function listLists(familyId: string, actorId: string) {
    return db
      .select()
      .from(taskLists)
      .where(accessFilter(familyId, actorId))
      .orderBy(
        sql`CASE WHEN ${taskLists.ownerId} = ${actorId} AND ${taskLists.isDefault} = 1 THEN 0 ELSE 1 END`,
        asc(taskLists.position),
        asc(taskLists.createdAt),
        asc(taskLists.id),
      )
      .all()
      .map(serialize);
  }
  function areFamilyMembers(familyId: string, memberIds: string[]) {
    if (!memberIds.length) return true;
    return (
      db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.familyId, familyId), inArray(users.id, memberIds)))
        .all().length === memberIds.length
    );
  }
  function setMembers(listId: string, memberIds: string[]) {
    const removed = members(listId).filter((id) => !memberIds.includes(id));
    if (removed.length) {
      db.update(tasks)
        .set({ assigneeId: null, updatedAt: Date.now() })
        .where(and(eq(tasks.listId, listId), inArray(tasks.assigneeId, removed)))
        .run();
    }
    db.delete(taskListMembers).where(eq(taskListMembers.listId, listId)).run();
    if (memberIds.length)
      db.insert(taskListMembers)
        .values(memberIds.map((userId) => ({ listId, userId })))
        .run();
  }
  function createList(familyId: string, ownerId: string, name: string, memberIds: string[]) {
    const now = Date.now();
    const position = Math.min(
      (db
        .select({ value: max(taskLists.position) })
        .from(taskLists)
        .where(eq(taskLists.ownerId, ownerId))
        .get()?.value ?? -1) + 1,
      2147483647,
    );
    const list = db
      .insert(taskLists)
      .values({
        id: crypto.randomUUID(),
        familyId,
        ownerId,
        name,
        position,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    setMembers(list.id, memberIds);
    return serialize(list);
  }
  function updateList(id: string, name?: string, memberIds?: string[]) {
    if (memberIds !== undefined) setMembers(id, memberIds);
    const list = db
      .update(taskLists)
      .set({ ...(name !== undefined ? { name } : {}), updatedAt: Date.now() })
      .where(eq(taskLists.id, id))
      .returning()
      .get()!;
    return serialize(list);
  }
  function removeList(id: string) {
    db.delete(taskLists).where(eq(taskLists.id, id)).run();
  }
  function prepareMemberRemoval(familyId: string, userId: string) {
    const owned = db
      .select()
      .from(taskLists)
      .where(and(eq(taskLists.familyId, familyId), eq(taskLists.ownerId, userId)))
      .all();
    for (const list of owned) {
      const successor = members(list.id)[0];
      if (!successor) {
        removeList(list.id);
        continue;
      }
      db.update(taskLists)
        .set({ ownerId: successor, isDefault: false, updatedAt: Date.now() })
        .where(eq(taskLists.id, list.id))
        .run();
      db.delete(taskListMembers)
        .where(and(eq(taskListMembers.listId, list.id), eq(taskListMembers.userId, successor)))
        .run();
    }
  }
  function listTasks(listId: string, status: TaskStatus) {
    return db
      .select()
      .from(tasks)
      .where(and(eq(tasks.listId, listId), status === 'all' ? undefined : eq(tasks.isDone, status === 'done')))
      .orderBy(asc(tasks.position), asc(tasks.createdAt), asc(tasks.id))
      .all()
      .map(serializeTask);
  }
  function findTask(familyId: string, actorId: string, id: string) {
    return db
      .select({ task: tasks })
      .from(tasks)
      .innerJoin(taskLists, eq(tasks.listId, taskLists.id))
      .where(and(eq(tasks.id, id), accessFilter(familyId, actorId)))
      .get()?.task;
  }
  function createTask(listId: string, actorId: string, data: CreateTask, id: string = crypto.randomUUID()) {
    const now = Date.now();
    const position = Math.min(
      (db
        .select({ value: max(tasks.position) })
        .from(tasks)
        .where(eq(tasks.listId, listId))
        .get()?.value ?? -1) + 1,
      2147483647,
    );
    return db
      .insert(tasks)
      .values({
        ...data,
        id,
        listId,
        position,
        createdBy: actorId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  }
  function updateTask(task: typeof tasks.$inferSelect, actorId: string, data: PatchTask) {
    const now = Date.now();
    const completion =
      data.isDone === undefined || data.isDone === task.isDone
        ? {}
        : data.isDone
          ? { doneBy: actorId, doneAt: now }
          : { doneBy: null, doneAt: null };
    return db
      .update(tasks)
      .set({ ...data, ...completion, updatedAt: now })
      .where(eq(tasks.id, task.id))
      .returning()
      .get()!;
  }
  function removeTask(id: string) {
    db.delete(tasks).where(eq(tasks.id, id)).run();
  }
  function todayTasks(familyId: string, actorId: string, today: string) {
    return db
      .select({ task: tasks })
      .from(tasks)
      .innerJoin(taskLists, eq(tasks.listId, taskLists.id))
      .where(and(accessFilter(familyId, actorId), eq(tasks.isDone, false), lte(tasks.dueDate, today)))
      .orderBy(asc(tasks.dueDate), asc(tasks.dueTime), asc(tasks.position), asc(tasks.createdAt), asc(tasks.id))
      .all()
      .map(({ task }) => serializeTask(task));
  }
  return {
    findAccessibleList,
    ensureDefault,
    listLists,
    areFamilyMembers,
    createList,
    updateList,
    removeList,
    setMembers,
    prepareMemberRemoval,
    listTasks,
    findTask,
    createTask,
    updateTask,
    removeTask,
    todayTasks,
    timezone: (familyId: string) => db.select().from(families).where(eq(families.id, familyId)).get()!.timezone,
  };
}
