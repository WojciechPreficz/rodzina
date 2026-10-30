import crypto from 'node:crypto';
import { and, asc, count, eq, inArray, lte, max, or, sql } from 'drizzle-orm';
import type { CreateTask, PatchTask, TaskStatus } from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { families, taskListMembers, taskLists, tasks, taskChecklistItems, taskSeries, users } from '../../db/schema.js';
import { taskRecurrenceMany } from './recurrence-data.js';
import { createReminderRepository } from '../reminders/repository.js';

export function createTaskListRepository(database: DatabaseConnection) {
  const db = database.db;
  const reminderRepository = createReminderRepository(database);
  function checklistMany(ids: string[]) {
    const result = new Map<string, (typeof taskChecklistItems.$inferSelect)[]>();
    for (let offset = 0; offset < ids.length; offset += 400) {
      const rows = db
        .select()
        .from(taskChecklistItems)
        .where(inArray(taskChecklistItems.taskId, ids.slice(offset, offset + 400)))
        .orderBy(asc(taskChecklistItems.position), asc(taskChecklistItems.id))
        .all();
      for (const row of rows) {
        if (!result.has(row.taskId)) result.set(row.taskId, []);
        result.get(row.taskId)!.push(row);
      }
    }
    return result;
  }
  function serializeMany(rows: (typeof tasks.$inferSelect)[]) {
    const recurrence = taskRecurrenceMany(
      database,
      rows.map((task) => task.id),
    );
    const checklist = checklistMany(rows.map((task) => task.id));
    const listIds = [...new Set(rows.map((task) => task.listId))];
    const familiesByList = new Map<string, string>();
    for (let offset = 0; offset < listIds.length; offset += 400)
      for (const row of db
        .select()
        .from(taskLists)
        .where(inArray(taskLists.id, listIds.slice(offset, offset + 400)))
        .all())
        familiesByList.set(row.id, row.familyId);
    const reminders = new Map<string, ReturnType<typeof reminderRepository.listTask>>();
    for (const familyId of new Set(familiesByList.values()))
      for (const [id, values] of reminderRepository.listMany(
        familyId,
        'taskId',
        rows.filter((task) => familiesByList.get(task.listId) === familyId).map((task) => task.id),
      ))
        reminders.set(id, values);
    return rows.map((task) => ({
      ...task,
      recurrence: recurrence.get(task.id) ?? null,
      reminders: reminders.get(task.id) ?? [],
      checklist: checklist.get(task.id) ?? [],
    }));
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
  function snapshot(familyId: string, actorId: string) {
    return db.transaction(() => {
      const rows = db
        .select()
        .from(taskLists)
        .where(accessFilter(familyId, actorId))
        .orderBy(
          sql`CASE WHEN ${taskLists.ownerId} = ${actorId} AND ${taskLists.isDefault} = 1 THEN 0 ELSE 1 END`,
          asc(taskLists.position),
          asc(taskLists.createdAt),
          asc(taskLists.id),
        )
        .all();
      const taskRows = db
        .select({ task: tasks })
        .from(tasks)
        .innerJoin(taskLists, eq(tasks.listId, taskLists.id))
        .where(accessFilter(familyId, actorId))
        .orderBy(asc(tasks.position), asc(tasks.createdAt), asc(tasks.id))
        .all()
        .map((row) => row.task);
      const memberRows = db
        .select({ listId: taskListMembers.listId, userId: users.id })
        .from(taskListMembers)
        .innerJoin(taskLists, eq(taskLists.id, taskListMembers.listId))
        .innerJoin(users, eq(users.id, taskListMembers.userId))
        .where(and(accessFilter(familyId, actorId), eq(users.familyId, familyId)))
        .orderBy(asc(users.createdAt), asc(users.id))
        .all();
      const shared = reminderRepository.listMany(
        familyId,
        'taskId',
        taskRows.map((task) => task.id),
      );
      const items: Record<string, ReturnType<typeof serializeMany>> = Object.fromEntries(
        rows.map((list) => [list.id, []]),
      );
      const memberIds = new Map<string, string[]>();
      for (const row of memberRows) {
        if (!memberIds.has(row.listId)) memberIds.set(row.listId, []);
        memberIds.get(row.listId)!.push(row.userId);
      }
      const checklist = checklistMany(taskRows.map((task) => task.id));
      const recurrence = taskRecurrenceMany(
        database,
        taskRows.map((task) => task.id),
      );
      for (const task of taskRows)
        items[task.listId]!.push({
          ...task,
          recurrence: recurrence.get(task.id) ?? null,
          checklist: checklist.get(task.id) ?? [],
          reminders: shared.get(task.id) ?? [],
        });
      const lists = rows.map((list) => ({
        ...list,
        memberIds: memberIds.get(list.id) ?? [],
        openTaskCount: items[list.id]!.filter((task) => !task.isDone).length,
      }));
      return { ok: true as const, taskRecurrenceVersion: 1 as const, lists, items };
    });
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
      clearTemplateAssignees(listId, removed);
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
    for (const list of db.select().from(taskLists).where(eq(taskLists.familyId, familyId)).all())
      clearTemplateAssignees(list.id, [userId]);
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
  function clearTemplateAssignees(listId: string, removed: string[]) {
    for (const series of db.select().from(taskSeries).where(eq(taskSeries.listId, listId)).all())
      if (series.template.assigneeId && removed.includes(series.template.assigneeId))
        db.update(taskSeries)
          .set({
            template: { ...series.template, assigneeId: null },
            version: series.version + 1,
            updatedAt: Date.now(),
          })
          .where(eq(taskSeries.id, series.id))
          .run();
  }
  function listTasks(listId: string, status: TaskStatus) {
    const rows = db
      .select()
      .from(tasks)
      .where(and(eq(tasks.listId, listId), status === 'all' ? undefined : eq(tasks.isDone, status === 'done')))
      .orderBy(asc(tasks.position), asc(tasks.createdAt), asc(tasks.id))
      .all();
    return serializeMany(rows);
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
    const rows = db
      .select({ task: tasks })
      .from(tasks)
      .innerJoin(taskLists, eq(tasks.listId, taskLists.id))
      .where(and(accessFilter(familyId, actorId), eq(tasks.isDone, false), lte(tasks.dueDate, today)))
      .orderBy(asc(tasks.dueDate), asc(tasks.dueTime), asc(tasks.position), asc(tasks.createdAt), asc(tasks.id))
      .all()
      .map(({ task }) => task);
    return serializeMany(rows);
  }
  return {
    snapshot,
    checklistMany,
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
