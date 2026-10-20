import { z } from 'zod';
import { calendarDateSchema } from './events.js';

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
});

export const createTaskSchema = taskFieldsSchema
  .partial({ notes: true, dueDate: true, dueTime: true, assigneeId: true })
  .strict()
  .refine((data) => !data.dueTime || !!data.dueDate, 'Godzina wymaga daty terminu.');
export const patchTaskSchema = taskFieldsSchema
  .extend({ isDone: z.boolean(), position: z.number().int().min(0).max(2147483647) })
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, 'Brak danych do zmiany.');
export const taskSchema = taskFieldsSchema.extend({
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
export const tasksResponseSchema = z.object({ ok: z.literal(true), tasks: z.array(taskSchema) });
export const taskResponseSchema = z.object({ ok: z.literal(true), task: taskSchema });
export const taskDeletedResponseSchema = z.object({ ok: z.literal(true), deleted: z.literal(true) });

export type Task = z.infer<typeof taskSchema>;
export type CreateTask = z.infer<typeof createTaskSchema>;
export type PatchTask = z.infer<typeof patchTaskSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
