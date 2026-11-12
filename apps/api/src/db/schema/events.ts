import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { families, users } from './family.js';

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    location: text('location'),
    startDate: text('start_date').notNull(),
    startTime: text('start_time'),
    durationMinutes: integer('duration_minutes'),
    datePrecision: text('date_precision', { enum: ['day', 'month'] }).notNull(),
    rrule: text('rrule'),
    kind: text('kind', { enum: ['single', 'recurring', 'distant'] }).notNull(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('events_family_date_idx').on(table.familyId, table.startDate),
    index('events_created_by_idx').on(table.createdBy),
  ],
);

export const eventImportOperations = sqliteTable(
  'event_import_operations',
  {
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    fingerprint: text('fingerprint').notNull(),
    // Keep the operation for replay even if the event is deleted during the retention window.
    eventId: text('event_id').notNull(),
    createdAt: integer('created_at').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.familyId, table.userId, table.id] }),
    index('event_import_operations_user_idx').on(table.userId),
    index('event_import_operations_created_at_idx').on(table.createdAt),
  ],
);

export const eventParticipants = sqliteTable(
  'event_participants',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.userId] })],
);

export const eventExceptions = sqliteTable(
  'event_exceptions',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    originalDate: text('original_date').notNull(),
    isCancelled: integer('is_cancelled', { mode: 'boolean' }).notNull().default(false),
    overrideStartDate: text('override_start_date'),
    overrideStartTime: text('override_start_time'),
    overrideDurationMinutes: integer('override_duration_minutes'),
    overrideTitle: text('override_title'),
  },
  (table) => [uniqueIndex('event_exceptions_event_date_idx').on(table.eventId, table.originalDate)],
);
