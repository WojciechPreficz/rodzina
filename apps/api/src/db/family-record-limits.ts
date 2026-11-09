import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { AppConfig } from '../config.js';
import { ApiError } from '../http/errors.js';
import type { DatabaseConnection } from './client.js';
import * as schema from './schema.js';

export function createFamilyRecordLimits(db: DatabaseConnection['db'], config: AppConfig) {
  const lists = (table: typeof schema.shoppingLists | typeof schema.taskLists, familyId: string) =>
    db.select({ id: table.id }).from(table).where(eq(table.familyId, familyId));
  const limits = {
    events: [schema.events, (id) => eq(schema.events.familyId, id), config.RODZINA_MAX_FAMILY_EVENTS, 'wydarzeń'],
    contacts: [
      schema.contacts,
      (id) => eq(schema.contacts.familyId, id),
      config.RODZINA_MAX_FAMILY_CONTACTS,
      'kontaktów',
    ],
    contactGroups: [
      schema.contactGroups,
      (id) => eq(schema.contactGroups.familyId, id),
      config.RODZINA_MAX_FAMILY_CONTACT_GROUPS,
      'grup kontaktów',
    ],
    shoppingLists: [
      schema.shoppingLists,
      (id) => eq(schema.shoppingLists.familyId, id),
      config.RODZINA_MAX_FAMILY_SHOPPING_LISTS,
      'list zakupów',
    ],
    shoppingItems: [
      schema.shoppingItems,
      (id) => inArray(schema.shoppingItems.listId, lists(schema.shoppingLists, id)),
      config.RODZINA_MAX_FAMILY_SHOPPING_ITEMS,
      'pozycji zakupów',
    ],
    taskLists: [
      schema.taskLists,
      (id) => eq(schema.taskLists.familyId, id),
      config.RODZINA_MAX_FAMILY_TASK_LISTS,
      'list zadań',
    ],
    tasks: [
      schema.tasks,
      (id) => inArray(schema.tasks.listId, lists(schema.taskLists, id)),
      config.RODZINA_MAX_FAMILY_TASKS,
      'zadań',
    ],
    taskSeries: [
      schema.taskSeries,
      (id) => inArray(schema.taskSeries.listId, lists(schema.taskLists, id)),
      config.RODZINA_MAX_FAMILY_TASK_SERIES,
      'serii zadań',
    ],
    documents: [
      schema.documents,
      (id) => eq(schema.documents.familyId, id),
      config.RODZINA_MAX_FAMILY_DOCUMENTS,
      'dokumentów',
    ],
    meals: [schema.meals, (id) => eq(schema.meals.familyId, id), config.RODZINA_MAX_FAMILY_MEALS, 'obiadów'],
    members: [schema.users, (id) => eq(schema.users.familyId, id), config.RODZINA_MAX_FAMILY_MEMBERS, 'domowników'],
  } satisfies Record<string, [SQLiteTable, (familyId: string) => SQL, number, string]>;
  type Resource = keyof typeof limits;

  // Check under the same SQLite write lock as the insertion.
  function hasCapacity(resource: Resource, familyId: string) {
    const [table, where, limit] = limits[resource];
    return !db
      .select({ found: sql`1` })
      .from(table)
      .where(where(familyId))
      .limit(1)
      .offset(limit - 1)
      .get();
  }

  function requireCapacity(resource: Resource, familyId: string) {
    const [, , limit, label] = limits[resource];
    if (!hasCapacity(resource, familyId))
      throw new ApiError(409, 'FAMILY_RECORD_LIMIT', `Rodzina osiągnęła limit ${label} (${limit}).`);
  }

  return { hasCapacity, requireCapacity };
}
