import { z } from 'zod';

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
