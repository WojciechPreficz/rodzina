import { type PatchTask, type Task, type TaskList } from '@rodzina/shared';
import { readTaskData, updateTaskData, clearTaskData } from './taskStorage.js';
import { ensureMigrated, activateOfflineAccount, accountToken, isAccountCurrent } from '../../offline/database.js';
import { apiFetch, ApiRequestError } from '../../api.js';
import { classify, operationSchema, type TaskOperation, type Snapshot } from './taskSchemas.js';
export { TASK_STORAGE_KEY, type TaskOperation } from './taskSchemas.js';

export const taskOfflineText = {
  banner: 'Jesteś offline — zmiany zostaną wysłane po odzyskaniu połączenia.',
  limits:
    'Bez internetu nie można tworzyć list, zmieniać ich ustawień i udostępniania ani opuszczać listy. Zmiana przypisanej osoby i konfiguracji przypomnień również wymaga internetu.',
  empty: 'Połącz się z internetem, aby pobrać zadania.',
  alarms:
    'Zmiany terminów i przywrócenie przypomnień oczekują na synchronizację. Alarmy zmienionych zadań są wstrzymane na tym urządzeniu.',
  review: 'Zmiany wymagające sprawdzenia',
  expired: 'Zmiana ma ponad 30 dni i nie zostanie wysłana automatycznie.',
  dependent: 'Zmiana czeka na rozstrzygnięcie wcześniejszej zmiany tego zadania.',
  blocked: 'Najpierw sprawdź i odrzuć wstrzymane zmiany tego zadania. Następnie odśwież dane przed nowym zapisem.',
};
export function taskOperationBlocksAlarm(op: TaskOperation) {
  return (
    op.change.type === 'remove' ||
    (op.change.type === 'update' &&
      (op.change.data.isDone !== undefined ||
        op.change.data.dueDate !== undefined ||
        op.change.data.dueTime !== undefined))
  );
}
export type TaskOfflineState = Snapshot & { pending: TaskOperation[]; error?: string | undefined; syncing: boolean };
type Transport = <T>(path: string, init?: RequestInit) => Promise<T>;
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Nie udało się zsynchronizować zadań.');
const storageError = () =>
  new Error(
    'Nie można zapisać zadań na urządzeniu. Zwolnij miejsce lub włącz pamięć przeglądarki. Zmiana nie została przyjęta.',
  );

// The journal is authoritative. Transactions merge concurrent writes and keep
// confirmed server data separate from the projection of pending operations.
export function createTaskOfflineStore(transport: Transport = apiFetch) {
  let state: TaskOfflineState = { account: '', items: {}, pending: [], syncing: false };
  let revision = 0;
  let sessionToken = accountToken();
  let running: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const emit = (next: TaskOfflineState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  let ready: Promise<void> = Promise.resolve();
  const discards = async () =>
    Object.entries((await readTaskData(state.account))?.discards ?? {}).map(([key, value]) => ({ key, ...value }));
  const journal = () => refreshPending();
  const persist = async (next: Snapshot) => {
    await updateTaskData(next.account, (data) => {
      data.snapshot = next;
    });
  };
  const refreshPending = async () => {
    const data = await updateTaskData(state.account, (value) => {
      value.operations = classify(value.operations);
    });
    return data.operations;
  };
  const current = (captured: number) => {
    if (captured !== revision || !isAccountCurrent(sessionToken))
      throw new DOMException('Session changed', 'AbortError');
  };
  function activate(account: string) {
    if (state.account === account && isAccountCurrent(sessionToken)) return ready;
    const captured = ++revision;
    sessionToken = accountToken();
    const token = accountToken();
    running = undefined;
    emit({ account, items: {}, pending: [], syncing: false });
    ready = (async () => {
      try {
        await ensureMigrated();
        current(captured);
        if (!isAccountCurrent(token)) throw new DOMException('Session changed', 'AbortError');
        await activateOfflineAccount(account);
        const data = await updateTaskData(account, (value) => {
          value.operations = classify(value.operations);
        });
        current(captured);
        if (!isAccountCurrent(token)) return;
        emit({ ...data.snapshot, pending: data.operations, syncing: false });
      } catch (error) {
        if (captured === revision && isAccountCurrent(token))
          emit({ ...state, error: `Nie można odczytać zapisanych zadań. ${errorText(error)}` });
      }
    })();
    return ready;
  }
  function clear(removeStored = true) {
    revision++;
    running = undefined;
    ready = Promise.resolve();
    const account = state.account;
    emit({ account: '', items: {}, pending: [], syncing: false });
    if (removeStored && account) return clearTaskData(account);
  }
  function project(): TaskOfflineState {
    const items = Object.fromEntries(Object.entries(state.items).map(([id, tasks]) => [id, [...tasks]]));
    const userId = state.account.split(':')[1]!;
    const pending = classify(state.pending);
    for (const op of pending) {
      if (op.status === 'needs-review') continue;
      const tasks = items[op.listId];
      if (!tasks) continue;
      if (op.change.type === 'remove') items[op.listId] = tasks.filter((task) => task.id !== op.taskId);
      else if (op.change.type === 'create') {
        if (!tasks.some((task) => task.id === op.taskId))
          tasks.push({
            ...op.change.data,
            notes: op.change.data.notes ?? null,
            dueDate: op.change.data.dueDate ?? null,
            dueTime: op.change.data.dueTime ?? null,
            assigneeId: op.change.data.assigneeId ?? null,
            reminders: [],
            id: op.taskId,
            listId: op.listId,
            isDone: false,
            doneBy: null,
            doneAt: null,
            position: tasks.length,
            createdBy: userId,
            createdAt: op.submittedAt,
            updatedAt: op.submittedAt,
          });
      } else {
        const data = Object.fromEntries(
          Object.entries(op.change.data).filter(([, value]) => value !== undefined),
        ) as Partial<Task>;
        items[op.listId] = tasks.map((task) =>
          task.id !== op.taskId
            ? task
            : {
                ...task,
                ...data,
                reminders: task.reminders,
                ...(data.isDone === undefined || data.isDone === task.isDone
                  ? {}
                  : { doneBy: data.isDone ? userId : null, doneAt: data.isDone ? op.submittedAt : null }),
                updatedAt: op.submittedAt,
              },
        );
      }
    }
    return {
      ...state,
      pending,
      items,
      lists: state.lists?.map((list) => ({
        ...list,
        openTaskCount: items[list.id]?.filter((task) => !task.isDone).length ?? list.openTaskCount,
      })),
    };
  }
  async function enqueue(listId: string, taskId: string, change: TaskOperation['change']) {
    const captured = revision;
    await ready;
    current(captured);
    const account = state.account;
    const result = await updateTaskData(account, (data) => {
      if (!data.snapshot.lists?.some((list) => list.id === listId) || !data.snapshot.items[listId])
        throw new Error(taskOfflineText.empty);
      const operations = classify(data.operations);
      if (operations.some((op) => op.listId === listId && op.taskId === taskId && op.status === 'needs-review'))
        throw new Error(taskOfflineText.blocked);
      if (Object.values(data.discards).some((entry) => entry.listId === listId && entry.requiresRefresh))
        throw new Error('Po odrzuceniu zmian połącz się z internetem i odśwież listę przed nowym zapisem.');
      data.operations = [
        ...operations,
        operationSchema.parse({
          id: crypto.randomUUID(),
          submittedAt: Math.max(Date.now(), (operations.at(-1)?.submittedAt ?? 0) + 1),
          listId,
          taskId,
          change,
        }),
      ];
    });
    current(captured);
    emit({ ...state, ...result.snapshot, pending: result.operations, error: undefined });
    window.dispatchEvent(new Event('rodzina:tasks-changed'));
    return project().items[listId]?.find((task) => task.id === taskId);
  }
  async function discardReview(operationIds: string[]) {
    const captured = revision;
    await ready;
    current(captured);
    const result = await updateTaskData(state.account, (data) => {
      const operations = classify(data.operations);
      const first = operations.find((op) => op.id === operationIds[0]);
      const chain = first && operations.filter((op) => op.listId === first.listId && op.taskId === first.taskId);
      if (
        !chain?.length ||
        chain.some((op) => op.status !== 'needs-review') ||
        chain.length !== operationIds.length ||
        chain.some((op, index) => op.id !== operationIds[index])
      )
        throw new Error('Lista zmian uległa zmianie. Otwórz ją ponownie przed odrzuceniem.');
      data.discards[crypto.randomUUID()] = { operationIds, listId: first!.listId, requiresRefresh: true };
      data.operations = operations.filter((op) => !operationIds.includes(op.id));
    });
    current(captured);
    emit({ ...state, pending: result.operations, error: undefined });
    window.dispatchEvent(new Event('rodzina:tasks-changed'));
  }
  async function synchronize() {
    await ready;
    if (!state.account) return;
    if (running) return running;
    const captured = revision;
    const account = state.account;
    let alarmsChanged = false;
    const work = async () => {
      emit({ ...state, syncing: true });
      try {
        const session = await transport<{ user: { id: string }; family: { id: string } }>('/api/auth/me');
        current(captured);
        if (`${session.family.id}:${session.user.id}` !== account) {
          await clear();
          window.dispatchEvent(new Event('rodzina:session-lost'));
          return;
        }
        // Access is refreshed before replay, including retries with saved responses.
        const { lists } = await transport<{ lists: TaskList[] }>('/api/tasks/lists');
        current(captured);
        const allowed = new Set(lists.map((list) => list.id));
        alarmsChanged = (await journal()).length > 0;
        const revoked = (await journal()).filter((op) => !allowed.has(op.listId));
        const items = Object.fromEntries(Object.entries(state.items).filter(([id]) => allowed.has(id)));
        // Revoked content must leave the UI even if local storage has failed.
        emit({ ...state, lists, items, pending: state.pending.filter((op) => allowed.has(op.listId)) });
        await updateTaskData(account, (data) => {
          data.snapshot = { account, lists, items };
          data.operations = data.operations.filter((op) => allowed.has(op.listId));
          data.discards = Object.fromEntries(
            Object.entries(data.discards).filter(([, entry]) => allowed.has(entry.listId)),
          );
        });
        emit({
          ...state,
          lists,
          items,
          pending: await journal(),
          error: revoked.length ? 'Utracono dostęp do listy. Jej oczekujące zmiany nie zostały wysłane.' : undefined,
        });
        try {
          for (const queued of await journal()) {
            const op = (await journal()).find((entry) => entry.id === queued.id);
            if (!op) continue;
            if (op.status === 'needs-review') {
              emit({ ...state, pending: await journal() });
              await refreshPending();
              continue;
            }
            try {
              const path =
                op.change.type === 'create'
                  ? `/api/tasks/lists/${encodeURIComponent(op.listId)}/tasks`
                  : `/api/tasks/${encodeURIComponent(op.taskId)}`;
              const response = await transport<{ task?: Task }>(
                `${path}?operationId=${op.id}&actorId=${session.user.id}${op.change.type === 'create' ? `&taskId=${op.taskId}` : ''}`,
                {
                  method: op.change.type === 'create' ? 'POST' : op.change.type === 'update' ? 'PATCH' : 'DELETE',
                  ...(op.change.type === 'remove' ? {} : { body: JSON.stringify(op.change.data) }),
                },
              );
              current(captured);
              const tasks = state.items[op.listId] ?? [];
              const updated = response.task
                ? [...tasks.filter((task) => task.id !== op.taskId), response.task]
                : tasks.filter((task) => task.id !== op.taskId);
              const next = { account, lists: state.lists, items: { ...state.items, [op.listId]: updated } };
              await updateTaskData(account, (data) => {
                const tasks = data.snapshot.items[op.listId] ?? [];
                data.snapshot.items[op.listId] = response.task
                  ? [...tasks.filter((task) => task.id !== op.taskId), response.task]
                  : tasks.filter((task) => task.id !== op.taskId);
                data.operations = data.operations.filter((entry) => entry.id !== op.id);
              });
              emit({ ...state, ...next, pending: await journal() });
            } catch (error) {
              current(captured);
              if (
                !(error instanceof ApiRequestError) ||
                error.status === 429 ||
                error.status >= 500 ||
                error.status === 401
              )
                throw error;
              // A rejected change cannot roll back subsequent offline changes.
              await updateTaskData(account, (data) => {
                data.operations = data.operations.filter((entry) => entry.id !== op.id);
              });
              emit({
                ...state,
                pending: await journal(),
                error: `${errorText(error)} Oczekująca zmiana nie została zapisana na serwerze.`,
              });
            }
          }
        } catch (error) {
          current(captured);
          if (error instanceof ApiRequestError && [401, 403].includes(error.status)) throw error;
          // Queue failures do not prevent refreshing the confirmed server state.
          emit({ ...state, error: errorText(error) });
        }
        for (const list of lists) {
          try {
            const awaitingRefresh = (await discards()).filter(
              (entry) => entry.listId === list.id && entry.requiresRefresh,
            );
            const result = await transport<{ tasks: Task[] }>(
              `/api/tasks/lists/${encodeURIComponent(list.id)}/tasks?status=all`,
            );
            current(captured);
            const next = {
              account,
              lists: state.lists,
              items: { ...state.items, [list.id]: result.tasks },
              syncedAt: Date.now(),
            };
            await updateTaskData(account, (data) => {
              data.snapshot = next;
              for (const { key } of awaitingRefresh)
                if (data.discards[key]) data.discards[key]!.requiresRefresh = false;
            });
            emit({ ...state, ...next });
          } catch (error) {
            current(captured);
            if (error instanceof ApiRequestError && [403, 404].includes(error.status)) {
              const nextItems = { ...state.items };
              delete nextItems[list.id];
              const next = { account, lists: state.lists?.filter((entry) => entry.id !== list.id), items: nextItems };

              emit({
                ...state,
                ...next,
                pending: state.pending.filter((op) => op.listId !== list.id),
                error: 'Utracono dostęp do listy zadań.',
              });
              await updateTaskData(account, (data) => {
                data.snapshot = next;
                data.operations = data.operations.filter((op) => op.listId !== list.id);
                data.discards = Object.fromEntries(
                  Object.entries(data.discards).filter(([, entry]) => entry.listId !== list.id),
                );
              });
            } else throw error;
          }
        }
      } catch (error) {
        if (captured === revision && isAccountCurrent(sessionToken)) {
          if (error instanceof ApiRequestError && [401, 403].includes(error.status)) {
            await clear();
            window.dispatchEvent(new Event('rodzina:session-lost'));
          } else if (error instanceof ApiRequestError && error.status === 404) {
            const next = { account, lists: [], items: {} };
            emit({ ...state, ...next, error: errorText(error) });
            try {
              await persist(next);
            } catch {
              emit({ ...state, error: storageError().message });
            }
          } else emit({ ...state, error: errorText(error) });
        }
      } finally {
        if (captured === revision && isAccountCurrent(sessionToken)) {
          running = undefined;
          emit({ ...state, syncing: false });
          if (alarmsChanged) window.dispatchEvent(new Event('rodzina:tasks-changed'));
        }
      }
    };
    running = work();
    return running;
  }
  return {
    activate,
    clear,
    enqueue,
    discardReview,
    blockedTasks: (account: string) =>
      state.account === account
        ? classify(state.pending)
            .filter(taskOperationBlocksAlarm)
            .map((op) => op.taskId)
        : [],
    synchronize,
    project,
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reload: async () => {
      const captured = revision;
      await ready;
      if (!state.account) return;
      try {
        const data = await updateTaskData(state.account, (value) => {
          value.operations = classify(value.operations);
        });
        current(captured);
        emit({ ...state, ...data.snapshot, pending: data.operations });
        window.dispatchEvent(new Event('rodzina:tasks-changed'));
      } catch (error) {
        if (captured === revision && isAccountCurrent(sessionToken)) emit({ ...state, error: errorText(error) });
      }
    },
  };
}
export const taskStore = createTaskOfflineStore();

// Only content changes are accepted offline; access and reminder configuration
// always go through an online request.
export function offlineTaskPatch(data: PatchTask, task?: Task): PatchTask {
  if (data.assigneeId !== undefined && data.assigneeId !== (task?.assigneeId ?? null))
    throw new Error(taskOfflineText.limits);
  if (data.reminders !== undefined) throw new Error(taskOfflineText.limits);
  const { assigneeId: _assignee, ...fields } = data;
  void _assignee;
  return fields;
}
