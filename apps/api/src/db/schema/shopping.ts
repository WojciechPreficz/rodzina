import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { ShoppingCategory } from '@rodzina/shared';
import { families, users } from './family.js';

export const shoppingLists = sqliteTable(
  'shopping_lists',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('shopping_lists_family_position_idx').on(table.familyId, table.position),
    index('shopping_lists_created_by_idx').on(table.createdBy),
  ],
);

export const shoppingItems = sqliteTable(
  'shopping_items',
  {
    id: text('id').primaryKey(),
    listId: text('list_id')
      .notNull()
      .references(() => shoppingLists.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    quantity: text('quantity'),
    category: text('category').$type<ShoppingCategory>().notNull().default('other'),
    isChecked: integer('is_checked', { mode: 'boolean' }).notNull().default(false),
    checkedBy: text('checked_by').references(() => users.id, { onDelete: 'set null' }),
    checkedAt: integer('checked_at'),
    position: integer('position').notNull().default(0),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('shopping_items_list_position_idx').on(table.listId, table.position),
    index('shopping_items_created_by_idx').on(table.createdBy),
  ],
);

export const shoppingHistory = sqliteTable(
  'shopping_history',
  {
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    nameNormalized: text('name_normalized').notNull(),
    displayName: text('display_name').notNull(),
    category: text('category').$type<ShoppingCategory>().notNull(),
    useCount: integer('use_count').notNull(),
    lastUsedAt: integer('last_used_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.familyId, table.nameNormalized] })],
);

export const shoppingOperations = sqliteTable(
  'shopping_operations',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    response: text('response').notNull(),
    status: integer('status').notNull(),
    createdAt: integer('created_at').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index('shopping_operations_created_at_idx').on(table.createdAt),
  ],
);
