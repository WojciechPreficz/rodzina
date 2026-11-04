import { taskSnapshotResponseSchema, type TaskSnapshotResponse, type Task, type PatchTask } from '@rodzina/shared';
import {
  clearTaskData,
  prepareTaskRead,
  readTaskChanges,
  readTaskData,
  taskCache,
  updateTaskData,
  type TaskData,
} from './taskStorage.js';
import { registerOfflineModule } from '../../offline/moduleStore.js';
import { apiFetch, ApiRequestError } from '../../api.js';
import { isOffline } from '../../connectivity.js';
import { taskAdapter, revokedTaskText, type TaskTransport } from './taskAdapter.js';
import { classify, operationSchema, type TaskOperation, type Snapshot } from './taskSchemas.js';
import { projectChecklist, unknownChecklistText } from './taskChecklistOffline.js';
import { projectTaskOccurrence } from './taskRecurrenceOffline.js';
export { checklistProgress } from './taskChecklistOffline.js';
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
  conflict: 'Zmiana jest sprzeczna ze stanem serwera i wymaga sprawdzenia.',
  rejected: 'Serwer odrzucił zmianę. Sprawdź aktualne dane przed ponowną edycją.',
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
type TaskView = Snapshot & { pending: TaskOperation[]; error?: string | undefined };
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Nie udało się zsynchronizować zadań.');
const tasksChanged = () => window.dispatchEvent(new Event('rodzina:tasks-changed'));
const emptyView = (account: string): TaskView => ({ account, items: {}, pending: [] });

function projectTasks(source: Snapshot, operations: TaskOperation[]): TaskView {
  const items = Object.fromEntries(Object.entries(source.items).map(([id, tasks]) => [id, [...tasks]]));
  const userId = source.account.split(':')[1]!;
  const pending = classify(operations);
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
          checklist: [],
          checklistOrderVersion: 0,
        });
    } else if (op.change.type === 'update') {
      const closedAt = op.change.data.closedAt ?? op.submittedAt;
      const data = Object.fromEntries(
        Object.entries(op.change.data).filter(
          ([key, value]) =>
            value !== undefined &&
            !['closedAt', 'expectedSeriesId', 'expectedSeriesVersion', 'expectedOccurrenceVersion'].includes(key),
        ),
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
                : { doneBy: data.isDone ? userId : null, doneAt: data.isDone ? closedAt : null }),
              updatedAt: op.submittedAt,
            },
      );
    } else {
      items[op.listId] = tasks.map((task) => {
        if (task.id !== op.taskId) return task;
        try {
          return projectChecklist(task, op, userId, false);
        } catch {
          return task;
        } // Never resurrect a missing parent/item or invent an unknown checklist.
      });
    }
    items[op.listId] = items[op.listId]!.map((task) =>
      task.id === op.taskId ? projectTaskOccurrence(task, op, userId) : task,
    );
    if (op.occurrence && op.change.type === 'update' && op.change.data.isDone === false)
      items[op.listId] = items[op.listId]!.filter(
        (task) =>
          task.recurrence?.seriesId !== op.occurrence!.seriesId || task.recurrence.sequence <= op.occurrence!.sequence,
      );
  }
  return {
    ...source,
    pending,
    items,
    lists: source.lists?.map((list) => ({
      ...list,
      openTaskCount: items[list.id]?.filter((task) => !task.isDone).length ?? list.openTaskCount,
    })),
  };
}

type TaskSyncContext = { transport: TaskTransport; hideList: (id: string) => void };
type TaskChange = Awaited<ReturnType<typeof readTaskChanges>>[number];
const taskModule = registerOfflineModule<TaskData, TaskChange, TaskView | undefined, TaskSyncContext>({
  mode: 'read-write',
  cache: taskCache,
  readError: (detail) => `Nie można odczytać zapisanych zadań. ${detail}`,
  prepareRead: prepareTaskRead,
  readChanges: readTaskChanges,
  project: (saved, changes): TaskView | undefined =>
    saved && {
      ...projectTasks(
        saved.snapshot,
        changes.map(({ operation }) => operation),
      ),
      error: saved.rejection ?? changes.find(({ error }) => error)?.error,
    },
  deferSync: true,
  sync: (account, context?: TaskSyncContext) => taskAdapter(account, context?.transport, context?.hideList),
});

export function createTaskOfflineStore(transport: TaskTransport = apiFetch) {
  const store = taskModule.createStore({ transport, hideList });
  const newPresentation = () => ({
    hidden: new Set<string>(),
    lists: undefined as Snapshot['lists'],
    error: undefined as string | undefined,
    running: undefined as Promise<void> | undefined,
  });
  let scope = store.accountScope();
  let presentation = newPresentation();
  function currentPresentation() {
    if (scope !== store.accountScope()) {
      scope = store.accountScope();
      presentation = newPresentation();
    }
    return presentation;
  }
  function hideList(id: string) {
    const ui = currentPresentation();
    ui.hidden.add(id);
    ui.error = revokedTaskText;
    store.notify();
  }
  let published: ReturnType<typeof store.snapshot> | undefined;
  let view: TaskView & { syncing: boolean };
  function getSnapshot() {
    const state = store.snapshot();
    if (state === published) return view;
    const ui = currentPresentation();
    const base = state.view ?? emptyView(state.account);
    const lists =
      ui.lists?.map((list) => ({
        ...list,
        openTaskCount: base.items[list.id]?.filter((task) => !task.isDone).length ?? list.openTaskCount,
      })) ?? base.lists;
    view = {
      ...base,
      lists: lists?.filter((list) => !ui.hidden.has(list.id)),
      items: ui.hidden.size
        ? Object.fromEntries(Object.entries(base.items).filter(([id]) => !ui.hidden.has(id)))
        : base.items,
      pending: ui.hidden.size ? base.pending.filter((op) => !ui.hidden.has(op.listId)) : base.pending,
      error: ui.error ?? state.issue ?? base.error,
      syncing: !!ui.running,
    };
    published = state;
    return view;
  }
  let alarmOperations = '';
  store.subscribe(() => {
    const next = getSnapshot()
      .pending.filter(taskOperationBlocksAlarm)
      .map((op) => op.id)
      .join(',');
    if (alarmOperations === next) return;
    alarmOperations = next;
    tasksChanged();
  });

  const assertCurrent = (scope: ReturnType<typeof store.accountScope>) => {
    if (!scope.current()) throw new DOMException('Session changed', 'AbortError');
  };
  async function activeAccount() {
    const scope = store.accountScope();
    await store.whenReady();
    assertCurrent(scope);
    return scope;
  }
  async function enqueue(listId: string, taskId: string, change: TaskOperation['change']) {
    const scope = await activeAccount();
    const { account } = scope;
    const result = await updateTaskData(
      account,
      (data) => {
        assertCurrent(scope);
        if (
          currentPresentation().hidden.has(listId) ||
          !data.snapshot.lists?.some((list) => list.id === listId) ||
          !data.snapshot.items[listId]
        )
          throw new Error(taskOfflineText.empty);
        const operations = classify(data.operations);
        const task = projectTasks(data.snapshot, operations).items[listId]?.find((task) => task.id === taskId);
        const recurrence = task?.recurrence;
        if (change.type === 'remove' && recurrence?.state === 'active' && isOffline())
          throw new Error('Pominięcie wystąpienia zadania cyklicznego wymaga internetu.');
        if (
          recurrence &&
          recurrence.seriesVersion === undefined &&
          change.type === 'update' &&
          change.data.isDone !== undefined
        )
          throw new Error('Połącz się z internetem, aby pobrać wersję serii zadania.');
        const occurrence =
          recurrence?.seriesVersion !== undefined
            ? {
                seriesId: recurrence.seriesId,
                sequence: recurrence.sequence,
                version: recurrence.version,
                seriesVersion: recurrence.seriesVersion!,
              }
            : undefined;
        const actualAt = Date.now();
        if (change.type === 'update' && change.data.isDone !== undefined && occurrence) {
          change = {
            ...change,
            data: {
              ...change.data,
              expectedSeriesVersion: occurrence.seriesVersion,
              expectedSeriesId: occurrence.seriesId,
              expectedOccurrenceVersion: occurrence.version,
              ...(change.data.isDone ? { closedAt: actualAt } : {}),
            },
          };
        }
        const candidate = operationSchema.parse({
          id: crypto.randomUUID(),
          submittedAt: Math.max(Date.now(), (operations.at(-1)?.submittedAt ?? 0) + 1),
          listId,
          taskId,
          occurrence,
          change,
        });
        if (
          classify([...operations, candidate]).at(-1)?.status === 'needs-review' ||
          (!change.type.startsWith('checklist-') &&
            operations.some((op) => op.listId === listId && op.taskId === taskId && op.status === 'needs-review'))
        )
          throw new Error(taskOfflineText.blocked);
        if (Object.values(data.discards).some((entry) => entry.listId === listId && entry.requiresRefresh))
          throw new Error('Po odrzuceniu zmian połącz się z internetem i odśwież listę przed nowym zapisem.');
        if (change.type.startsWith('checklist-')) {
          if (!task) throw new Error('Zadanie nie istnieje.');
          if (task.checklist === undefined || task.checklistOrderVersion === undefined)
            throw new Error(unknownChecklistText);
          projectChecklist(task, candidate, account.split(':')[1]!);
        }
        data.operations = [...operations, candidate];
      },
      scope.token,
    );
    publishChange(scope, result);
    return getSnapshot().items[listId]?.find((task) => task.id === taskId);
  }
  async function discardReview(operationIds: string[]) {
    const scope = await activeAccount();
    const result = await updateTaskData(
      scope.account,
      (data) => {
        assertCurrent(scope);
        const operations = classify(data.operations);
        const first = operations.find((op) => op.id === operationIds[0]);
        const chain =
          first &&
          operations.filter(
            (op) => op.listId === first.listId && op.taskId === first.taskId && op.status === 'needs-review',
          );
        if (
          !chain?.length ||
          chain.some((op) => op.status !== 'needs-review') ||
          chain.length !== operationIds.length ||
          chain.some((op, index) => op.id !== operationIds[index])
        )
          throw new Error('Lista zmian uległa zmianie. Otwórz ją ponownie przed odrzuceniem.');
        data.discards[crypto.randomUUID()] = { operationIds, listId: first!.listId, requiresRefresh: true };
        data.operations = operations.filter((op) => !operationIds.includes(op.id));
      },
      scope.token,
    );
    publishChange(scope, result);
  }

  function publishChange(scope: ReturnType<typeof store.accountScope>, data: TaskData) {
    assertCurrent(scope);
    currentPresentation().error = undefined;
    store.publishCommitted(
      scope,
      { ...data, operations: [] },
      data.operations.map((operation) => ({ operation, error: undefined })),
    );
    tasksChanged();
  }

  function keepVisible(data: TaskData, allowed: Set<string>) {
    if (data.operations.some((op) => !allowed.has(op.listId))) data.rejection = revokedTaskText;
    data.operations = data.operations.filter((op) => allowed.has(op.listId));
    data.discards = Object.fromEntries(Object.entries(data.discards).filter(([, entry]) => allowed.has(entry.listId)));
  }
  async function synchronize() {
    const scope = store.accountScope();
    await store.whenReady();
    if (!scope.current()) return;
    const { account, token } = scope;
    const ui = currentPresentation();
    if (ui.running) return ui.running;
    const read = () => readTaskData(account, token);
    const write = (update: (data: TaskData) => void) =>
      updateTaskData(
        account,
        (data) => {
          assertCurrent(scope);
          update(data);
        },
        token,
      );
    const load = async () => {
      const snapshot = taskSnapshotResponseSchema.parse(await transport<TaskSnapshotResponse>('/api/tasks/snapshot'));
      assertCurrent(scope);
      const visible = new Set(snapshot.lists.map((list) => list.id));
      // Hide revoked content even if the following durable write fails.
      const previous = store.snapshot().view;
      const known = [
        ...Object.keys(previous?.items ?? {}),
        ...(previous?.lists?.map((list) => list.id) ?? []),
        ...(previous?.pending.map((operation) => operation.listId) ?? []),
      ];
      for (const id of known) if (!visible.has(id)) ui.hidden.add(id);
      for (const id of visible) ui.hidden.delete(id);
      ui.lists = snapshot.lists;
      store.notify();
      return { snapshot, visible };
    };
    async function loseSession() {
      assertCurrent(scope);
      store.clear();
      const cleared = store.accountScope();
      await clearTaskData(account, token);
      if (cleared === store.accountScope()) window.dispatchEvent(new Event('rodzina:session-lost'));
    }

    let sessionConfirmed = false;
    ui.running = Promise.resolve().then(async () => {
      try {
        const session = await transport<{ user: { id: string }; family: { id: string } }>('/api/auth/me');
        assertCurrent(scope);
        if (`${session.family.id}:${session.user.id}` !== account) {
          await loseSession();
          return;
        }
        sessionConfirmed = true;
        const initial = await read();
        assertCurrent(scope);
        let { snapshot, visible } = await load();
        const saved = await write((data) => {
          data.snapshot.lists = snapshot.lists;
          data.snapshot.items = Object.fromEntries(
            Object.entries(data.snapshot.items).filter(([id]) => visible.has(id)),
          );
          keepVisible(data, visible);
        });
        assertCurrent(scope);
        ui.error = undefined;
        const replaying = saved.operations.length > 0;
        await store.synchronize();
        assertCurrent(scope);

        const before = replaying ? await read() : initial;
        assertCurrent(scope);
        const beforeItems = JSON.stringify(
          replaying
            ? before.snapshot.items
            : Object.fromEntries(Object.entries(before.snapshot.items).filter(([id]) => visible.has(id))),
        );
        if (replaying) ({ snapshot, visible } = await load());

        await write((data) => {
          if (JSON.stringify(data.snapshot.items) !== beforeItems) return;
          // A background refresh must not publish a successor before the closure's ACK.
          if (
            data.operations.some(
              (op) =>
                op.status !== 'needs-review' &&
                op.occurrence &&
                op.change.type === 'update' &&
                op.change.data.isDone !== undefined,
            )
          )
            return;
          data.snapshot = { account, lists: snapshot.lists, items: snapshot.items, syncedAt: Date.now() };
          keepVisible(data, visible);
          for (const key of Object.keys(before.discards))
            if (data.discards[key]) data.discards[key]!.requiresRefresh = false;
        });
        assertCurrent(scope);
        ui.lists = undefined;
        await store.reload();
      } catch (error) {
        if (!scope.current()) return;
        if (error instanceof ApiRequestError && [401, 403].includes(error.status)) await loseSession();
        else if (!sessionConfirmed && error instanceof ApiRequestError && error.status === 404) {
          const next = { account, lists: [], items: {} };
          ui.lists = [];
          for (const id of Object.keys(getSnapshot().items)) ui.hidden.add(id);
          ui.error = errorText(error);
          store.notify();
          try {
            await write((data) => {
              data.snapshot = next;
            });
            await store.reload();
          } catch {
            ui.error =
              'Nie można zapisać zadań na urządzeniu. Zwolnij miejsce lub włącz pamięć przeglądarki. Zmiana nie została przyjęta.';
          }
        } else ui.error = errorText(error);
      } finally {
        if (scope.current()) {
          ui.running = undefined;
          store.notify();
        }
      }
    });
    store.notify();
    return ui.running;
  }

  return {
    activate: store.activate,
    clear: store.clear,
    enqueue,
    discardReview,
    blockedTasks: (account: string) =>
      getSnapshot().account === account
        ? getSnapshot()
            .pending.filter(taskOperationBlocksAlarm)
            .map((op) => op.taskId)
        : [],
    synchronize,
    getSnapshot,
    subscribe: store.subscribe,
    reload: store.reload,
  };
}
export const taskStore = createTaskOfflineStore();
export const registerTaskStore = () => taskModule.registerStore(taskStore);

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
