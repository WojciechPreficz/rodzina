import crypto from 'node:crypto';
import { and, asc, eq, inArray, max, or, sql } from 'drizzle-orm';
import type { DatabaseConnection } from '../../db/client.js';
import { taskListMembers, taskLists, tasks, users } from '../../db/schema.js';

export function createTaskListRepository(database: DatabaseConnection) {
  const db = database.db;
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
    return { ...list, memberIds: members(list.id) };
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
  };
}
