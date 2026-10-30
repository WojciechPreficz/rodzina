import { z } from 'zod';
import { calendarDateSchema } from './events.js';
import { reminderSchema, sharedTaskReminderSchema } from './reminders.js';
import { taskOccurrenceSchema } from './task-recurrence.js';

const nameSchema = z.string().trim().min(1).max(200);
const memberIdsSchema = z.array(z.string().uuid()).max(200);

export const createTaskListSchema = z.object({ name: nameSchema, memberIds: memberIdsSchema.optional() }).strict();
export const patchTaskListSchema = createTaskListSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, 'Brak danych do zmiany.');

export const taskListSchema = z.object({
  id: z.string().uuid(),
  familyId: z.string().uuid(),
  ownerId: z.string().uuid(),
  name: nameSchema,
  isDefault: z.boolean(),
  position: z.number().int().nonnegative(),
  memberIds: memberIdsSchema,
  openTaskCount: z.number().int().nonnegative(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export const taskListsResponseSchema = z.object({ ok: z.literal(true), lists: z.array(taskListSchema) });
export const taskListResponseSchema = z.object({ ok: z.literal(true), list: taskListSchema });
export const taskListDeletedResponseSchema = z.object({ ok: z.literal(true), deleted: z.literal(true) });
export const taskListLeftResponseSchema = z.object({ ok: z.literal(true), left: z.literal(true) });

export type TaskList = z.infer<typeof taskListSchema>;
export type CreateTaskList = z.infer<typeof createTaskListSchema>;
export type PatchTaskList = z.infer<typeof patchTaskListSchema>;

const taskFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(10000).nullable(),
  dueDate: calendarDateSchema.nullable(),
  dueTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  assigneeId: z.string().uuid().nullable(),
  reminders: z.array(sharedTaskReminderSchema).max(20).optional(),
});

export const createTaskSchema = taskFieldsSchema
  .partial({ notes: true, dueDate: true, dueTime: true, assigneeId: true })
  .strict()
  .refine((data) => !data.dueTime || !!data.dueDate, 'Godzina wymaga daty terminu.');
export const patchTaskSchema = taskFieldsSchema
  .extend({
    isDone: z.boolean(),
    position: z.number().int().min(0).max(2147483647),
    closedAt: z.number().int().nonnegative().max(253402300799999),
    expectedOccurrenceVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    expectedSeriesVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, 'Brak danych do zmiany.')
  .refine((data) => data.closedAt === undefined || data.isDone === true, 'Czas dotyczy wykonania.')
  .refine(
    (data) => (data.expectedOccurrenceVersion === undefined) === (data.expectedSeriesVersion === undefined),
    'Podaj obie wersje.',
  )
  .refine((data) => data.closedAt === undefined || data.expectedOccurrenceVersion !== undefined, 'Czas wymaga wersji.');
const versionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const taskChecklistItemSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  title: nameSchema,
  position: z.number().int().nonnegative(),
  isDone: z.boolean(),
  doneBy: z.string().uuid().nullable(),
  doneAt: z.number().int().nullable(),
  version: versionSchema,
  doneVersion: versionSchema,
  createdBy: z.string().uuid().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export const createTaskChecklistItemSchema = z.object({ id: z.string().uuid(), title: nameSchema }).strict();
export const patchTaskChecklistItemSchema = z.union([
  z.object({ title: nameSchema, version: versionSchema }).strict(),
  z.object({ isDone: z.boolean(), doneVersion: versionSchema }).strict(),
]);
export const deleteTaskChecklistItemSchema = z.object({ version: versionSchema, doneVersion: versionSchema }).strict();
export const reorderTaskChecklistSchema = z
  .object({
    orderVersion: versionSchema,
    itemIds: z
      .array(z.string().uuid())
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();
export const taskChecklistResponseSchema = z.object({
  ok: z.literal(true),
  items: z.array(taskChecklistItemSchema).max(100),
  orderVersion: versionSchema,
});
export type TaskChecklistItem = z.infer<typeof taskChecklistItemSchema>;
export type CreateTaskChecklistItem = z.infer<typeof createTaskChecklistItemSchema>;
export type PatchTaskChecklistItem = z.infer<typeof patchTaskChecklistItemSchema>;
export type DeleteTaskChecklistItem = z.infer<typeof deleteTaskChecklistItemSchema>;
export type ReorderTaskChecklist = z.infer<typeof reorderTaskChecklistSchema>;

export const taskSchema = taskFieldsSchema.extend({
  recurrence: taskOccurrenceSchema.nullable().optional(),
  checklist: z.array(taskChecklistItemSchema).max(100).optional(),
  checklistOrderVersion: versionSchema.optional(),
  reminders: z.array(reminderSchema).optional(),
  id: z.string().uuid(),
  listId: z.string().uuid(),
  isDone: z.boolean(),
  doneBy: z.string().uuid().nullable(),
  doneAt: z.number().int().nullable(),
  position: z.number().int().nonnegative(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export const taskStatusSchema = z.enum(['open', 'done', 'all']);
export const tasksQuerySchema = z.object({ status: taskStatusSchema.default('open') }).strict();
export const tasksResponseSchema = z.object({
  ok: z.literal(true),
  taskRecurrenceVersion: z.literal(1).optional(),
  tasks: z.array(taskSchema),
});
export const taskResponseSchema = z.object({
  ok: z.literal(true),
  taskRecurrenceVersion: z.literal(1).optional(),
  task: taskSchema,
});
export const taskDeletedResponseSchema = z.object({ ok: z.literal(true), deleted: z.literal(true) });

export type Task = z.infer<typeof taskSchema>;
export type CreateTask = z.infer<typeof createTaskSchema>;
export type PatchTask = z.infer<typeof patchTaskSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;

// A complete replacement; missing lists or task groups must never clear a cache.
export const taskSnapshotResponseSchema = z
  .object({
    ok: z.literal(true),
    taskRecurrenceVersion: z.literal(1).optional(),
    lists: z.array(taskListSchema),
    items: z.record(z.array(taskSchema)),
  })
  .superRefine((snapshot, ctx) => {
    const ids = new Set(snapshot.lists.map((list) => list.id));
    if (
      ids.size !== snapshot.lists.length ||
      Object.keys(snapshot.items).length !== ids.size ||
      snapshot.lists.some((list) => !snapshot.items[list.id]) ||
      Object.entries(snapshot.items).some(([id, tasks]) => !ids.has(id) || tasks.some((task) => task.listId !== id))
    )
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Niekompletna odpowiedź zadań.' });
  });
export type TaskSnapshotResponse = z.infer<typeof taskSnapshotResponseSchema>;
