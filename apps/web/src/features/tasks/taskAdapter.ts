import { taskChecklistResponseSchema, taskSchema, taskSnapshotResponseSchema, type TaskList } from '@rodzina/shared';
import { apiFetch, ApiRequestError } from '../../api.js';
import type { SyncAdapter, SyncRun } from '../../offline/sync.js';
import { readTaskTransaction, putTaskTransaction, putTaskBaseTransaction, taskOperation } from './taskStorage.js';

export type TaskTransport = <T>(path: string, init?: RequestInit) => Promise<T>;
export const revokedTaskText = 'Utracono dostęp do listy. Jej oczekujące zmiany nie zostały wysłane.';

export function taskAdapter(
  account: string,
  transport: TaskTransport = apiFetch,
  hideList?: (id: string) => void,
): SyncAdapter {
  const accessByRun = new WeakMap<SyncRun, Set<string>>();
  const readAccess = async (signal: AbortSignal, run?: SyncRun) => {
    if (run) accessByRun.delete(run);
    const { lists } = await transport<{ lists: TaskList[] }>('/api/tasks/lists', { signal });
    signal.throwIfAborted();
    const access = new Set(lists.map((list) => list.id));
    if (run) accessByRun.set(run, access);
    return access;
  };
  const revoke = (listId: string, signal: AbortSignal): never => {
    signal.throwIfAborted();
    hideList?.(listId);
    throw new ApiRequestError(revokedTaskText, 403, 'TASK_LIST_REVOKED');
  };
  return {
    module: 'tasks',
    sessionTransport: transport,
    prepare: async (operation, signal, run) => {
      const cached = accessByRun.get(run);
      const access = cached ?? (await readAccess(signal, run));
      const { listId } = taskOperation(operation);
      if (!access.has(listId)) {
        // A cached negative may predate a change to list membership.
        if (cached && (await readAccess(signal, run)).has(listId)) return;
        revoke(listId, signal);
      }
    },
    send: async (operation, signal, run) => {
      const op = taskOperation(operation);
      const change = op.change;
      const checklist = change.type.startsWith('checklist-');
      const path =
        op.change.type === 'create'
          ? `/api/tasks/lists/${encodeURIComponent(op.listId)}/tasks`
          : `/api/tasks/${encodeURIComponent(op.taskId)}${checklist ? '/checklist' : ''}${change.type === 'checklist-order' ? '/order' : 'itemId' in change ? `/${encodeURIComponent(change.itemId)}` : ''}`;
      try {
        const response = await transport(
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
        // A compatible API returns only the parent. Keep the operation pending
        // until its successor and current access can be committed with its ACK.
        if (
          op.occurrence ||
          change.type === 'remove' ||
          (change.type === 'update' && change.data.isDone !== undefined)
        ) {
          const snapshot = taskSnapshotResponseSchema.parse(await transport('/api/tasks/snapshot', { signal }));
          if (run && !snapshot.lists.some((list) => list.id === op.listId)) accessByRun.delete(run);
          return { response, snapshot };
        }
        return response;
      } catch (error) {
        if (!(error instanceof ApiRequestError) || error.status === 401 || error.code === 'SESSION_CHANGED')
          throw error;
        if (error.code === 'TASK_LIST_REVOKED') {
          if (run) accessByRun.delete(run);
          revoke(op.listId, signal);
        }
        if (error.status === 403 || error.status === 404) {
          if (run && error.status === 403) delete run.session;
          const access = await readAccess(signal, run);
          if (!access.has(op.listId)) revoke(op.listId, signal);
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
      if (response && typeof response === 'object' && 'snapshot' in response) {
        const snapshot = taskSnapshotResponseSchema.parse(response.snapshot);
        data.snapshot = { account, lists: snapshot.lists, items: snapshot.items, syncedAt: Date.now() };
        await putTaskBaseTransaction(tx, data);
        return;
      }
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
