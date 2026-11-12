import { sql } from 'drizzle-orm';
import { foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { families, users } from './family.js';

export const contactGroups = sqliteTable(
  'contact_groups',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('contact_groups_id_family_idx').on(table.id, table.familyId),
    uniqueIndex('contact_groups_default_idx')
      .on(table.familyId)
      .where(sql`${table.isDefault} = 1`),
    index('contact_groups_family_idx').on(table.familyId),
    index('contact_groups_created_by_idx').on(table.createdBy),
  ],
);

export const contacts = sqliteTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    groupId: text('group_id').notNull(),
    name: text('name').notNull(),
    address: text('address'),
    phone: text('phone'),
    birthday: text('birthday'),
    birthdayMonthDay: text('birthday_month_day'),
    relationship: text('relationship'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.groupId, table.familyId],
      foreignColumns: [contactGroups.id, contactGroups.familyId],
    }),
    index('contacts_family_group_idx').on(table.familyId, table.groupId),
    index('contacts_created_by_idx').on(table.createdBy),
  ],
);
