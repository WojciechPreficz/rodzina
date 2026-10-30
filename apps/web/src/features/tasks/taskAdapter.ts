import { taskChecklistResponseSchema, taskSchema, type TaskList } from '@rodzina/shared';
import { apiFetch, ApiRequestError } from '../../api.js';
import type { SyncAdapter } from '../../offline/sync.js';
import { readTaskTransaction, putTaskTransaction, putTaskBaseTransaction, taskOperation } from './taskStorage.js';

export type TaskTransport = <T>(path: string, init?: RequestInit) => Promise<T>;
export const revokedTaskText = 'Utracono dostęp do listy. Jej oczekujące zmiany nie zostały wysłane.';

export function taskAdapter(
  account: string,
  transport: TaskTransport = apiFetch,
  hideList?: (id: string) => void,
): SyncAdapter {
  return {
    module: 'tasks',
    prepare: async (operation, signal) => {
      const session = await transport<{ user: { id: string }; family: { id: string } }>('/api/auth/me', { signal });
      if (`${session.family.id}:${session.user.id}` !== account)
        throw new ApiRequestError('Sesja konta uległa zmianie.', 401, 'SESSION_CHANGED');
      const { lists } = await transport<{ lists: TaskList[] }>('/api/tasks/lists', { signal });
      const op = taskOperation(operation);
      if (!lists.some((list) => list.id === op.listId)) {
        if (!signal.aborted) hideList?.(op.listId);
        throw new ApiRequestError(revokedTaskText, 403, 'TASK_LIST_REVOKED');
      }
    },
    send: async (operation, signal) => {
      const op = taskOperation(operation);
      const change = op.change;
      const checklist = change.type.startsWith('checklist-');
      const path =
        op.change.type === 'create'
          ? `/api/tasks/lists/${encodeURIComponent(op.listId)}/tasks`
          : `/api/tasks/${encodeURIComponent(op.taskId)}${checklist ? '/checklist' : ''}${change.type === 'checklist-order' ? '/order' : 'itemId' in change ? `/${encodeURIComponent(change.itemId)}` : ''}`;
      try {
        return await transport(
          `${path}?operationId=${op.id}&actorId=${encodeURIComponent(account.split(':')[1]!)}${op.change.type === 'create' ? `&taskId=${op.taskId}` : ''}`,
          {
            signal,
            method:
              change.type === 'create' || change.type === 'checklist-create'
                ? 'POST'
                : change.type === 'remove' || change.type === 'checklist-remove'
                  ? 'DELETE'
                  : 'PATCH',
            ...(op.change.type === 'remove' ? {} : { body: JSON.stringify(op.change.data) }),
          },
        );
      } catch (error) {
        if (error instanceof ApiRequestError && [403, 404].includes(error.status)) {
          const { lists } = await transport<{ lists: TaskList[] }>('/api/tasks/lists', { signal });
          if (!lists.some((list) => list.id === op.listId)) {
            if (!signal.aborted) hideList?.(op.listId);
            throw new ApiRequestError(revokedTaskText, 403, 'TASK_LIST_REVOKED');
          }
          if (checklist && error.status === 404) {
            // A missing item is not evidence that its parent was deleted.
            try {
              await transport(`/api/tasks/${encodeURIComponent(op.taskId)}/checklist`, { signal });
            } catch (parentError) {
              if (parentError instanceof ApiRequestError && parentError.status === 404)
                throw new ApiRequestError('Zadanie zostało usunięte.', 404, 'TASK_PARENT_DELETED');
              throw parentError;
            }
          }
        }
        throw error;
      }
    },
    reconcile: async (tx, operation, response) => {
      const data = await readTaskTransaction(tx, account);
      const op = taskOperation(operation);
      const tasks = data.snapshot.items[op.listId];
      if (op.change.type.startsWith('checklist-')) {
        const result = taskChecklistResponseSchema.parse(response);
        if (tasks)
          data.snapshot.items[op.listId] = tasks.map((task) =>
            task.id === op.taskId
              ? { ...task, checklist: result.items, checklistOrderVersion: result.orderVersion }
              : task,
          );
      } else if (tasks) {
        data.snapshot.items[op.listId] =
          op.change.type === 'remove'
            ? tasks.filter((task) => task.id !== op.taskId)
            : [
                ...tasks.filter((task) => task.id !== op.taskId),
                taskSchema.parse((response as { task: unknown }).task),
              ];
      }
      await putTaskBaseTransaction(tx, data);
    },
    invalidateAccess: async (tx, operation, error) => {
      const data = await readTaskTransaction(tx, account);
      const op = taskOperation(operation);
      // A mutation-level 403/404 can also mean a deleted task or denied assignment.
      // List visibility is rechecked before replay and by the next base refresh.
      if (error.code === 'TASK_LIST_REVOKED') {
        delete data.snapshot.items[op.listId];
        data.snapshot.lists = data.snapshot.lists?.filter((list) => list.id !== op.listId);
        data.operations = data.operations.filter((entry) => entry.listId !== op.listId);
        data.discards = Object.fromEntries(
          Object.entries(data.discards).filter(([, entry]) => entry.listId !== op.listId),
        );
        data.rejection = revokedTaskText;
      } else if (
        error.status === 404 &&
        (!op.change.type.startsWith('checklist-') || error.code === 'TASK_PARENT_DELETED')
      ) {
        data.snapshot.items[op.listId] = data.snapshot.items[op.listId]?.filter((task) => task.id !== op.taskId) ?? [];
      }
      await putTaskTransaction(tx, data);
    },
  };
}
