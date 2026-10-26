import { z } from 'zod';
import {
  taskListSchema,
  taskSchema,
  createTaskSchema,
  patchTaskSchema,
  assertOfflineReplayAge,
  OfflineOperationExpiredError,
} from '@rodzina/shared';
export const TASK_STORAGE_KEY = 'rodzina:tasks:v1';
export const operationSchema = z.object({
  id: z.string().uuid(),
  submittedAt: z.number(),
  listId: z.string(),
  taskId: z.string(),
  status: z.enum(['pending', 'needs-review']).default('pending'),
  reason: z.enum(['expired', 'dependency']).optional(),
  change: z.discriminatedUnion('type', [
    z.object({ type: z.literal('create'), data: createTaskSchema }),
    z.object({ type: z.literal('update'), data: patchTaskSchema }),
    z.object({ type: z.literal('remove') }),
  ]),
});
export type TaskOperation = z.infer<typeof operationSchema>;
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
    const key = `${op.listId}:${op.taskId}`;
    let reason = op.status === 'needs-review' ? (op.reason ?? 'expired') : undefined;
    if (!reason) {
      try {
        assertOfflineReplayAge(op.submittedAt);
      } catch (error) {
        if (!(error instanceof OfflineOperationExpiredError)) throw error;
        reason = 'expired';
      }
    }
    if (!reason && blocked.has(key)) reason = 'dependency';
    if (!reason) return op;
    blocked.add(key);
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
