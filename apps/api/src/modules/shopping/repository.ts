import crypto from 'node:crypto';
import { and, asc, desc, eq, inArray, max, sql } from 'drizzle-orm';
import type { CreateShoppingItem, CreateShoppingList, PatchShoppingItem, PatchShoppingList } from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { shoppingLists, shoppingItems, shoppingHistory } from '../../db/schema.js';

function normalizeName(name: string) {
  return name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('pl-PL');
}

export function createShoppingRepository(database: DatabaseConnection) {
  const db = database.db;
  function findList(familyId: string, id: string) {
    return db
      .select()
      .from(shoppingLists)
      .where(and(eq(shoppingLists.familyId, familyId), eq(shoppingLists.id, id)))
      .get();
  }
  function createList(familyId: string, actorId: string, data: CreateShoppingList, id?: string) {
    return db.transaction(
      () => {
        const position = Math.min(
          (db
            .select({ value: max(shoppingLists.position) })
            .from(shoppingLists)
            .where(eq(shoppingLists.familyId, familyId))
            .get()?.value ?? -1) + 1,
          2147483647,
        );
        const now = Date.now();
        return db
          .insert(shoppingLists)
          .values({
            ...data,
            id: id ?? crypto.randomUUID(),
            familyId,
            position,
            createdBy: actorId,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
      },
      { behavior: 'immediate' },
    );
  }
  function listLists(familyId: string, actorId: string) {
    return db.transaction(
      () => {
        const lists = db
          .select()
          .from(shoppingLists)
          .where(eq(shoppingLists.familyId, familyId))
          .orderBy(asc(shoppingLists.position), asc(shoppingLists.id))
          .all();
        return lists.length ? lists : [createList(familyId, actorId, { name: 'Zakupy' })];
      },
      { behavior: 'immediate' },
    );
  }
  function updateList(familyId: string, id: string, data: PatchShoppingList) {
    return db
      .update(shoppingLists)
      .set({ ...data, updatedAt: Date.now() })
      .where(and(eq(shoppingLists.familyId, familyId), eq(shoppingLists.id, id)))
      .returning()
      .get();
  }
  function removeList(familyId: string, id: string) {
    db.delete(shoppingLists)
      .where(and(eq(shoppingLists.familyId, familyId), eq(shoppingLists.id, id)))
      .run();
  }
  const visibleListIds = (familyId: string) =>
    db.select({ id: shoppingLists.id }).from(shoppingLists).where(eq(shoppingLists.familyId, familyId));
  function findItem(familyId: string, id: string) {
    return db
      .select()
      .from(shoppingItems)
      .where(and(eq(shoppingItems.id, id), inArray(shoppingItems.listId, visibleListIds(familyId))))
      .get();
  }
  function listItems(familyId: string, listId: string) {
    return db
      .select()
      .from(shoppingItems)
      .where(and(eq(shoppingItems.listId, listId), inArray(shoppingItems.listId, visibleListIds(familyId))))
      .orderBy(asc(shoppingItems.isChecked), asc(shoppingItems.position), asc(shoppingItems.id))
      .all();
  }
  function createItem(familyId: string, listId: string, actorId: string, data: CreateShoppingItem, id?: string) {
    return db.transaction(
      () => {
        // Guard the parent inside the same transaction as the insert and history update.
        if (!findList(familyId, listId)) return undefined;
        const nameNormalized = normalizeName(data.name);
        const previous = db
          .select()
          .from(shoppingHistory)
          .where(and(eq(shoppingHistory.familyId, familyId), eq(shoppingHistory.nameNormalized, nameNormalized)))
          .get();
        const category = data.category ?? previous?.category ?? 'other';
        const now = Date.now();
        const position = Math.min(
          (db
            .select({ value: max(shoppingItems.position) })
            .from(shoppingItems)
            .where(eq(shoppingItems.listId, listId))
            .get()?.value ?? -1) + 1,
          2147483647,
        );
        const item = db
          .insert(shoppingItems)
          .values({
            ...data,
            id: id ?? crypto.randomUUID(),
            listId,
            category,
            quantity: data.quantity || null,
            position,
            createdBy: actorId,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        db.insert(shoppingHistory)
          .values({ familyId, nameNormalized, displayName: data.name, category, useCount: 1, lastUsedAt: now })
          .onConflictDoUpdate({
            target: [shoppingHistory.familyId, shoppingHistory.nameNormalized],
            set: { displayName: data.name, category, useCount: sql`${shoppingHistory.useCount} + 1`, lastUsedAt: now },
          })
          .run();
        return item;
      },
      { behavior: 'immediate' },
    );
  }
  function updateItem(familyId: string, id: string, actorId: string, data: PatchShoppingItem) {
    return db.transaction(
      () => {
        const item = findItem(familyId, id);
        if (!item) return undefined;
        const now = Date.now();
        const changedCheck = data.isChecked !== undefined && data.isChecked !== item.isChecked;
        return db
          .update(shoppingItems)
          .set({
            ...data,
            ...(data.quantity !== undefined ? { quantity: data.quantity || null } : {}),
            ...(changedCheck
              ? { checkedBy: data.isChecked ? actorId : null, checkedAt: data.isChecked ? now : null }
              : {}),
            updatedAt: now,
          })
          .where(and(eq(shoppingItems.id, id), inArray(shoppingItems.listId, visibleListIds(familyId))))
          .returning()
          .get();
      },
      { behavior: 'immediate' },
    );
  }
  function removeItem(familyId: string, id: string) {
    db.delete(shoppingItems)
      .where(and(eq(shoppingItems.id, id), inArray(shoppingItems.listId, visibleListIds(familyId))))
      .run();
  }
  function clearChecked(familyId: string, listId: string) {
    return db
      .delete(shoppingItems)
      .where(
        and(
          eq(shoppingItems.listId, listId),
          eq(shoppingItems.isChecked, true),
          inArray(shoppingItems.listId, visibleListIds(familyId)),
        ),
      )
      .run().changes;
  }
  function suggestions(familyId: string, query: string) {
    const prefix = normalizeName(query);
    return db
      .select({ name: shoppingHistory.displayName, category: shoppingHistory.category })
      .from(shoppingHistory)
      .where(and(eq(shoppingHistory.familyId, familyId), sql`instr(${shoppingHistory.nameNormalized}, ${prefix}) = 1`))
      .orderBy(desc(shoppingHistory.useCount), desc(shoppingHistory.lastUsedAt), asc(shoppingHistory.nameNormalized))
      .limit(8)
      .all();
  }
  return {
    findList,
    createList,
    listLists,
    updateList,
    removeList,
    findItem,
    listItems,
    createItem,
    updateItem,
    removeItem,
    clearChecked,
    suggestions,
  };
}
