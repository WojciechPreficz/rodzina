import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { check } from 'drizzle-orm/sqlite-core';

export const families = sqliteTable('families', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Europe/Warsaw'),
  joinCode: text('join_code').notNull().unique(),
  createdAt: integer('created_at').notNull(),
});

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  familyId: text('family_id')
    .notNull()
    .references(() => families.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  email: text('email').unique(),
  passwordHash: text('password_hash'),
  pinHash: text('pin_hash'),
  role: text('role', { enum: ['admin', 'member', 'child'] })
    .notNull()
    .default('member'),
  color: text('color').notNull().default('#5c7cfa'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
  createdAt: integer('created_at').notNull(),
  userAgent: text('user_agent'),
});

export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: integer('created_at').notNull(),
    lastSuccessAt: integer('last_success_at'),
  },
  (table) => [index('push_subscriptions_user_idx').on(table.userId)],
);

export const invitations = sqliteTable('invitations', {
  id: text('id').primaryKey(),
  familyId: text('family_id')
    .notNull()
    .references(() => families.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  role: text('role', { enum: ['admin', 'member'] }).notNull(),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
  usedAt: integer('used_at'),
});

export const passwordResets = sqliteTable('password_resets', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: integer('expires_at').notNull(),
  usedAt: integer('used_at'),
});

export const jobRuns = sqliteTable('job_runs', {
  id: text('id').primaryKey(),
  job: text('job').notNull(),
  ranAt: integer('ran_at').notNull(),
});

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
  (table) => [index('events_family_date_idx').on(table.familyId, table.startDate)],
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

export const reminders = sqliteTable(
  'reminders',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    eventId: text('event_id').references(() => events.id, { onDelete: 'cascade' }),
    taskId: text('task_id'),
    documentId: text('document_id'),
    type: text('type', { enum: ['offset', 'absolute'] }).notNull(),
    offsetValue: integer('offset_value'),
    offsetUnit: text('offset_unit', { enum: ['minute', 'hour', 'day', 'week', 'month'] }),
    remindAt: integer('remind_at'),
    audience: text('audience', { enum: ['participants', 'family', 'adults', 'owner', 'user'] }).notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    nextFireAt: integer('next_fire_at'),
    lastSentAt: integer('last_sent_at'),
  },
  (table) => [
    index('reminders_event_idx').on(table.familyId, table.eventId),
    index('reminders_next_fire_idx').on(table.nextFireAt),
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
