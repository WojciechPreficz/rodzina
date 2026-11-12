import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { TaskRecurrenceRule, TaskSeriesTemplate } from '@rodzina/shared';
import { families, users } from './family.js';

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
    index('tasks_created_by_idx').on(table.createdBy),
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
    index('task_series_created_by_idx').on(table.createdBy),
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
  (table) => [
    index('task_checklist_task_position_idx').on(table.taskId, table.position),
    index('task_checklist_items_created_by_idx').on(table.createdBy),
  ],
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
