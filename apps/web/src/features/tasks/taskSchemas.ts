import { z } from 'zod';
import {
  taskListSchema,
  taskSchema,
  createTaskSchema,
  patchTaskSchema,
  assertOfflineReplayAge,
  OfflineOperationExpiredError,
  createTaskChecklistItemSchema,
  patchTaskChecklistItemSchema,
  deleteTaskChecklistItemSchema,
  reorderTaskChecklistSchema,
} from '@rodzina/shared';
export const TASK_STORAGE_KEY = 'rodzina:tasks:v1';
export const operationSchema = z.object({
  id: z.string().uuid(),
  submittedAt: z.number(),
  listId: z.string(),
  taskId: z.string(),
  status: z.enum(['pending', 'needs-review']).default('pending'),
  reason: z.enum(['expired', 'dependency', 'conflict', 'rejected']).optional(),
  change: z.discriminatedUnion('type', [
    z.object({ type: z.literal('create'), data: createTaskSchema }),
    z.object({ type: z.literal('update'), data: patchTaskSchema }),
    z.object({ type: z.literal('remove') }),
    z.object({ type: z.literal('checklist-create'), data: createTaskChecklistItemSchema }),
    z.object({ type: z.literal('checklist-update'), itemId: z.string().uuid(), data: patchTaskChecklistItemSchema }),
    z.object({ type: z.literal('checklist-remove'), itemId: z.string().uuid(), data: deleteTaskChecklistItemSchema }),
    z.object({ type: z.literal('checklist-order'), data: reorderTaskChecklistSchema }),
  ]),
});
export type TaskOperation = z.infer<typeof operationSchema>;
export function taskOrderingKeys(op: Pick<TaskOperation, 'listId' | 'taskId' | 'change'>): string[] {
  const base = `tasks:list:${op.listId}:task:${op.taskId}`;
  const change = op.change;
  if (change.type === 'checklist-order') return [`${base}:order`];
  if (change.type === 'checklist-create')
    return [`${base}:item:${change.data.id}:title`, `${base}:item:${change.data.id}:done`, `${base}:order`];
  if (change.type === 'checklist-remove')
    return [`${base}:item:${change.itemId}:title`, `${base}:item:${change.itemId}:done`, `${base}:order`];
  if (change.type === 'checklist-update')
    return [`${base}:item:${change.itemId}:${'title' in change.data ? 'title' : 'done'}`];
  return [base];
}
export const discardSchema = z.object({
  operationIds: z.array(z.string().uuid()),
  listId: z.string(),
  requiresRefresh: z.boolean(),
});

// Classification also runs offline, before replay can persist the new status.
// A clock correction must never revive an operation already marked for review.
export function classify(operations: TaskOperation[]): TaskOperation[] {
  const blocked = new Set<string>();
  return operations.map((op) => {
    const parent = `${op.listId}:${op.taskId}`;
    const keys = taskOrderingKeys(op);
    let reason = op.status === 'needs-review' ? (op.reason ?? 'expired') : undefined;
    if (!reason) {
      try {
        assertOfflineReplayAge(op.submittedAt);
      } catch (error) {
        if (!(error instanceof OfflineOperationExpiredError)) throw error;
        reason = 'expired';
      }
    }
    if (!reason && (blocked.has(parent) || keys.some((key) => blocked.has(key)))) reason = 'dependency';
    if (!reason) return op;
    keys.forEach((key) => blocked.add(key));
    if (!op.change.type.startsWith('checklist-')) blocked.add(parent);
    return { ...op, status: 'needs-review', reason };
  });
}

export const snapshotSchema = z.object({
  account: z.string(),
  lists: z.array(taskListSchema).optional(),
  items: z.record(z.array(taskSchema)),
  syncedAt: z.number().optional(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
