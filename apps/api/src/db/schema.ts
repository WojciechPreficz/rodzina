import { foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { check } from 'drizzle-orm/sqlite-core';
import type { DocumentType, ShoppingCategory, TaskRecurrenceRule, TaskSeriesTemplate } from '@rodzina/shared';

export const meals = sqliteTable(
  'meals',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id')
      .notNull()
      .references(() => families.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    slot: text('slot').$type<'dinner'>().notNull().default('dinner'),
    title: text('title').notNull(),
    notes: text('notes'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('meals_family_date_slot_idx').on(table.familyId, table.date, table.slot),
    index('meals_family_updated_idx').on(table.familyId, table.updatedAt),
    check('meals_dinner_slot', sql`${table.slot} = 'dinner'`),
  ],
);

export const mealIngredients = sqliteTable(
  'meal_ingredients',
  {
    id: text('id').primaryKey(),
    mealId: text('meal_id')
      .notNull()
      .references(() => meals.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    quantity: text('quantity'),
    position: integer('position').notNull(),
  },
  (table) => [index('meal_ingredients_meal_position_idx').on(table.mealId, table.position)],
);

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

// Receipts only detect repeated manual exports; they never synchronize source changes.
export const mealShoppingExports = sqliteTable(
  'meal_shopping_exports',
  {
    mealId: text('meal_id')
      .notNull()
      .references(() => meals.id, { onDelete: 'cascade' }),
    listId: text('list_id')
      .notNull()
      .references(() => shoppingLists.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.mealId, table.listId] })],
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
    checklistOrderVersion: integer('checklist_order_version').notNull().default(0),
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
  (table) => [
    index('tasks_list_position_idx').on(table.listId, table.position),
    uniqueIndex('tasks_id_list_idx').on(table.id, table.listId),
  ],
);

export const taskSeries = sqliteTable(
  'task_series',
  {
    id: text('id').primaryKey(),
    listId: text('list_id')
      .notNull()
      .references(() => taskLists.id, { onDelete: 'cascade' }),
    rule: text('rule', { mode: 'json' }).$type<TaskRecurrenceRule>().notNull(),
    template: text('template', { mode: 'json' }).$type<TaskSeriesTemplate>().notNull(),
    state: text('state', { enum: ['active', 'stopped', 'ended'] })
      .notNull()
      .default('active'),
    version: integer('version').notNull().default(0),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('task_series_id_list_idx').on(table.id, table.listId),
    index('task_series_list_idx').on(table.listId),
    check('task_series_state', sql`${table.state} IN ('active', 'stopped', 'ended')`),
    check('task_series_version', sql`${table.version} >= 0`),
  ],
);

// The task remains the visible item. Its immutable planned deadline and history live here.
export const taskOccurrences = sqliteTable(
  'task_occurrences',
  {
    taskId: text('task_id').primaryKey(),
    listId: text('list_id').notNull(),
    seriesId: text('series_id').notNull(),
    sequence: integer('sequence').notNull(),
    plannedDate: text('planned_date').notNull(),
    plannedTime: text('planned_time'),
    state: text('state', { enum: ['active', 'done', 'skipped'] })
      .notNull()
      .default('active'),
    closedAt: integer('closed_at'),
    closedBy: text('closed_by').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull().default(0),
  },
  (table) => [
    foreignKey({ columns: [table.taskId, table.listId], foreignColumns: [tasks.id, tasks.listId] }).onDelete('cascade'),
    foreignKey({
      columns: [table.seriesId, table.listId],
      foreignColumns: [taskSeries.id, taskSeries.listId],
    }).onDelete('cascade'),
    uniqueIndex('task_occurrences_sequence_idx').on(table.seriesId, table.sequence),
    uniqueIndex('task_occurrences_active_idx')
      .on(table.seriesId)
      .where(sql`${table.state} = 'active'`),
    check('task_occurrences_sequence', sql`${table.sequence} >= 0 AND ${table.version} >= 0`),
    check(
      'task_occurrences_closure',
      sql`(${table.state} = 'active' AND ${table.closedAt} IS NULL AND ${table.closedBy} IS NULL) OR (${table.state} IN ('done', 'skipped') AND ${table.closedAt} IS NOT NULL AND ${table.closedAt} >= 0)`,
    ),
  ],
);

// Independent of visible tasks: deleting completed rows must preserve series history.
export const taskSeriesHistory = sqliteTable(
  'task_series_history',
  {
    id: text('id').primaryKey(),
    seriesId: text('series_id')
      .notNull()
      .references(() => taskSeries.id, { onDelete: 'cascade' }),
    taskId: text('task_id').notNull(),
    sequence: integer('sequence').notNull(),
    title: text('title').notNull(),
    plannedDate: text('planned_date').notNull(),
    plannedTime: text('planned_time'),
    state: text('state', { enum: ['done', 'skipped'] }).notNull(),
    closedAt: integer('closed_at').notNull(),
    closedBy: text('closed_by').references(() => users.id, { onDelete: 'set null' }),
    seriesVersion: integer('series_version').notNull(),
    successorId: text('successor_id'),
    successorFingerprint: text('successor_fingerprint'),
    undoneAt: integer('undone_at'),
    undoneBy: text('undone_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [
    index('task_series_history_series_idx').on(table.seriesId, table.sequence),
    uniqueIndex('task_series_history_closure_idx')
      .on(table.seriesId, table.sequence)
      .where(sql`${table.undoneAt} IS NULL`),
    check('task_series_history_state', sql`${table.state} IN ('done', 'skipped')`),
  ],
);

export const taskChecklistItems = sqliteTable(
  'task_checklist_items',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    position: integer('position').notNull(),
    isDone: integer('is_done', { mode: 'boolean' }).notNull().default(false),
    doneBy: text('done_by').references(() => users.id, { onDelete: 'set null' }),
    doneAt: integer('done_at'),
    version: integer('version').notNull().default(0),
    doneVersion: integer('done_version').notNull().default(0),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [index('task_checklist_task_position_idx').on(table.taskId, table.position)],
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
