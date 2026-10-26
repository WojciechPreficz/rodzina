import type { Task, TaskList } from '@rodzina/shared';
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
      const path =
        op.change.type === 'create'
          ? `/api/tasks/lists/${encodeURIComponent(op.listId)}/tasks`
          : `/api/tasks/${encodeURIComponent(op.taskId)}`;
      try {
        return await transport(
          `${path}?operationId=${op.id}&actorId=${encodeURIComponent(account.split(':')[1]!)}${op.change.type === 'create' ? `&taskId=${op.taskId}` : ''}`,
          {
            signal,
            method: op.change.type === 'create' ? 'POST' : op.change.type === 'update' ? 'PATCH' : 'DELETE',
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
        }
        throw error;
      }
    },
    reconcile: async (tx, operation, response) => {
      const data = await readTaskTransaction(tx, account);
      const op = taskOperation(operation);
      const result = response as { task?: Task };
      const tasks = data.snapshot.items[op.listId];
      if (tasks)
        data.snapshot.items[op.listId] = result.task
          ? [...tasks.filter((task) => task.id !== op.taskId), result.task]
          : tasks.filter((task) => task.id !== op.taskId);
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
      } else if (error.status === 404) {
        data.snapshot.items[op.listId] = data.snapshot.items[op.listId]?.filter((task) => task.id !== op.taskId) ?? [];
      }
      await putTaskTransaction(tx, data);
    },
  };
}
