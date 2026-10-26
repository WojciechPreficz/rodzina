import { foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { check } from 'drizzle-orm/sqlite-core';
import type { DocumentType, ShoppingCategory } from '@rodzina/shared';

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

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull(),
    userAgent: text('user_agent'),
  },
  (table) => [index('sessions_user_idx').on(table.userId)],
);

export const authRateLimits = sqliteTable(
  'auth_rate_limits',
  {
    scopeKey: text('scope_key').primaryKey(),
    count: integer('count').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [index('auth_rate_limits_expiry_idx').on(table.expiresAt)],
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

export const documents = sqliteTable(
  'documents',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    type: text('type').$type<DocumentType>().notNull(),
    label: text('label').notNull(),
    holderUserId: text('holder_user_id').references(() => users.id, { onDelete: 'set null' }),
    vehicleLabel: text('vehicle_label'),
    expiresOn: text('expires_on').notNull(),
    notes: text('notes'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('documents_family_expiry_idx').on(table.familyId, table.expiresOn)],
);

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
  ],
);

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
  (table) => [index('shopping_lists_family_position_idx').on(table.familyId, table.position)],
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
  (table) => [index('shopping_items_list_position_idx').on(table.listId, table.position)],
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

export const taskLists = sqliteTable(
  'task_lists',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    position: integer('position').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    index('task_lists_family_owner_idx').on(table.familyId, table.ownerId),
    uniqueIndex('task_lists_default_owner_idx')
      .on(table.ownerId)
      .where(sql`${table.isDefault} = 1`),
  ],
);

export const taskListMembers = sqliteTable(
  'task_list_members',
  {
    listId: text('list_id')
      .notNull()
      .references(() => taskLists.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.listId, table.userId] }),
    index('task_list_members_user_idx').on(table.userId),
  ],
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    listId: text('list_id')
      .notNull()
      .references(() => taskLists.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    notes: text('notes'),
    dueDate: text('due_date'),
    dueTime: text('due_time'),
    assigneeId: text('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    isDone: integer('is_done', { mode: 'boolean' }).notNull().default(false),
    doneBy: text('done_by').references(() => users.id, { onDelete: 'set null' }),
    doneAt: integer('done_at'),
    position: integer('position').notNull().default(0),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('tasks_list_position_idx').on(table.listId, table.position)],
);

export const taskOperations = sqliteTable(
  'task_operations',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    listId: text('list_id')
      .notNull()
      .references(() => taskLists.id, { onDelete: 'cascade' }),
    fingerprint: text('fingerprint').notNull(),
    response: text('response').notNull(),
    status: integer('status').notNull(),
    createdAt: integer('created_at').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    index('task_operations_created_at_idx').on(table.createdAt),
  ],
);
