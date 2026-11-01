import type { Task } from '@rodzina/shared';
import type { TaskOperation } from './taskSchemas.js';

export const recurrencePendingText = 'Kolejne zadanie po synchronizacji.';

// Versions describe the base used at enqueue time, never the state at retry time.
export function projectTaskOccurrence(task: Task, op: TaskOperation, actor: string): Task {
  const occurrence = task.recurrence;
  // Legacy journal entries keep their original wire payload. Their content and
  // checklist writes still advance the version used by a newly queued closure.
  const context =
    op.occurrence ??
    (occurrence?.seriesVersion === undefined ? undefined : { ...occurrence, seriesVersion: occurrence.seriesVersion });
  if (!context || !occurrence || occurrence.seriesId !== context.seriesId || occurrence.version > context.version)
    return task;
  const change = op.change;
  const closing = change.type === 'update' && change.data.isDone === true && occurrence.state === 'active';
  const reopening = change.type === 'update' && change.data.isDone === false && occurrence.state !== 'active';
  const content =
    change.type === 'update' &&
    Object.keys(change.data).some(
      (key) =>
        !['isDone', 'closedAt', 'expectedSeriesVersion', 'expectedOccurrenceVersion', 'expectedSeriesId'].includes(key),
    );
  if (!closing && !reopening && !content && !change.type.startsWith('checklist-')) return task;
  return {
    ...task,
    recurrence: {
      ...occurrence,
      version: context.version + 1,
      seriesVersion: context.seriesVersion + (closing || reopening ? 1 : 0),
      ...(closing ? { state: 'done' as const, closedAt: change.data.closedAt ?? op.submittedAt, closedBy: actor } : {}),
      ...(reopening ? { state: 'active' as const, closedAt: null, closedBy: null } : {}),
    },
  };
}

export function pendingTaskSuccessor(tasks: Task[], pending: TaskOperation[]) {
  return tasks.some(
    (task) =>
      task.isDone &&
      task.recurrence &&
      pending.some(
        (op) =>
          op.taskId === task.id &&
          op.status !== 'needs-review' &&
          op.change.type === 'update' &&
          op.change.data.isDone === true,
      ),
  );
}
