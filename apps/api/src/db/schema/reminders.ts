import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { documents } from './documents.js';
import { events } from './events.js';
import { families, users } from './family.js';
import { tasks } from './tasks.js';

export const reminders = sqliteTable(
  'reminders',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    eventId: text('event_id').references(() => events.id, { onDelete: 'cascade' }),
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    documentId: text('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['offset', 'absolute'] }).notNull(),
    offsetValue: integer('offset_value'),
    offsetUnit: text('offset_unit', { enum: ['minute', 'hour', 'day', 'week', 'month'] }),
    remindAt: integer('remind_at'),
    audience: text('audience', {
      enum: ['participants', 'family', 'adults', 'owner', 'user', 'list_members'],
    }).notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    nextFireAt: integer('next_fire_at'),
    lastSentAt: integer('last_sent_at'),
  },
  (table) => [
    index('reminders_event_idx').on(table.familyId, table.eventId),
    index('reminders_document_idx').on(table.familyId, table.documentId),
    index('reminders_task_idx').on(table.taskId, table.familyId),
    index('reminders_next_fire_idx').on(table.nextFireAt),
    index('reminders_created_by_idx').on(table.createdBy),
    check(
      'reminders_one_source',
      sql`(${table.eventId} IS NOT NULL) + (${table.taskId} IS NOT NULL) + (${table.documentId} IS NOT NULL) = 1`,
    ),
    check(
      'reminders_personal_user',
      sql`(${table.audience} = 'user' AND ${table.userId} IS NOT NULL) OR (${table.audience} <> 'user' AND ${table.userId} IS NULL)`,
    ),
  ],
);
