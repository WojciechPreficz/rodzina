import { taskSnapshotResponseSchema, type TaskSnapshotResponse, type Task, type PatchTask } from '@rodzina/shared';
import { readTaskData, updateTaskData, clearTaskData } from './taskStorage.js';
import {
  ensureMigrated,
  activateOfflineAccount,
  accountToken,
  isAccountCurrent,
  transact,
} from '../../offline/database.js';
import { readOperations } from '../../offline/outbox.js';
import { apiFetch, ApiRequestError } from '../../api.js';
import { joinSync } from '../../offline/sync.js';
import { taskAdapter, revokedTaskText } from './taskAdapter.js';
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
  let sender: ReturnType<typeof joinSync> | undefined;
  const hiddenLists = new Set<string>();
  const listeners = new Set<() => void>();
  const emit = (next: TaskOfflineState) => {
    state = {
      ...next,
      lists: next.lists?.filter((list) => !hiddenLists.has(list.id)),
      items: Object.fromEntries(Object.entries(next.items).filter(([id]) => !hiddenLists.has(id))),
      pending: next.pending.filter((op) => !hiddenLists.has(op.listId)),
    };
    listeners.forEach((listener) => listener());
  };
  let ready: Promise<void> = Promise.resolve();
  const discards = async () =>
    Object.entries((await readTaskData(state.account))?.discards ?? {}).map(([key, value]) => ({ key, ...value }));
  const persist = async (next: Snapshot) => {
    await updateTaskData(next.account, (data) => {
      data.snapshot = next;
    });
  };
  const current = (captured: number) => {
    if (captured !== revision || !isAccountCurrent(sessionToken))
      throw new DOMException('Session changed', 'AbortError');
  };
  function activate(account: string) {
    if (state.account === account && isAccountCurrent(sessionToken)) return ready;
    const captured = ++revision;
    hiddenLists.clear();
    sessionToken = accountToken();
    const token = accountToken();
    sender?.stop();
    sender = undefined;
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
        emit({ ...data.snapshot, pending: data.operations, error: data.rejection, syncing: false });
      } catch (error) {
        if (captured === revision && isAccountCurrent(token))
          emit({ ...state, error: `Nie można odczytać zapisanych zadań. ${errorText(error)}` });
      }
    })();
    return ready;
  }
  function clear(removeStored = true) {
    revision++;
    sender?.stop();
    sender = undefined;
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
    let sessionConfirmed = false;
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
        sessionConfirmed = true;
        // Access is refreshed before replay, including retries with saved responses.
        const initialDiscards = await discards();
        const initialItems = (await readTaskData(account))!.snapshot.items;
        current(captured);
        let snapshot = taskSnapshotResponseSchema.parse(await transport<TaskSnapshotResponse>('/api/tasks/snapshot'));
        const { lists } = snapshot;
        current(captured);
        const allowed = new Set(lists.map((list) => list.id));
        for (const list of lists) hiddenLists.delete(list.id);
        for (const id of Object.keys(state.items)) if (!allowed.has(id)) hiddenLists.add(id);
        alarmsChanged = state.pending.length > 0;
        const items = Object.fromEntries(Object.entries(state.items).filter(([id]) => allowed.has(id)));
        // Revoked content must leave the UI even if local storage has failed.
        emit({ ...state, lists, items, pending: state.pending.filter((op) => allowed.has(op.listId)) });
        const saved = await updateTaskData(account, (data) => {
          current(captured);
          if (data.operations.some((op) => !allowed.has(op.listId))) data.rejection = revokedTaskText;
          data.snapshot.lists = lists;
          data.snapshot.items = Object.fromEntries(
            Object.entries(data.snapshot.items).filter(([id]) => allowed.has(id)),
          );
          data.operations = data.operations.filter((op) => allowed.has(op.listId));
          data.discards = Object.fromEntries(
            Object.entries(data.discards).filter(([, entry]) => allowed.has(entry.listId)),
          );
        });
        current(captured);
        emit({
          ...state,
          ...saved.snapshot,
          pending: saved.operations,
          error: saved.rejection,
        });
        sender ??= joinSync(
          account,
          taskAdapter(account, transport, (listId) => {
            if (captured !== revision || !isAccountCurrent(sessionToken)) return;
            hiddenLists.add(listId);
            const items = { ...state.items };
            delete items[listId];
            emit({
              ...state,
              items,
              lists: state.lists?.filter((list) => list.id !== listId),
              pending: state.pending.filter((op) => op.listId !== listId),
              error: revokedTaskText,
            });
          }),
          async () => {
            if (captured !== revision || !isAccountCurrent(sessionToken)) return;
            const data = await readTaskData(account);
            const operations = await transact('readonly', (tx) => readOperations(tx, account));
            current(captured);
            emit({
              ...state,
              ...data!.snapshot,
              pending: data!.operations,
              error: data!.rejection ?? operations.find((op) => op.module === 'tasks' && op.lastError)?.lastError,
            });
            window.dispatchEvent(new Event('rodzina:tasks-changed'));
          },
        );
        const replaying = state.pending.length > 0;
        await sender.synchronize();
        current(captured);
        const awaitingRefresh = replaying ? await discards() : initialDiscards;
        const before = JSON.stringify(
          replaying
            ? (await readTaskData(account))!.snapshot.items
            : Object.fromEntries(Object.entries(initialItems).filter(([id]) => allowed.has(id))),
        );
        current(captured);
        if (replaying) {
          snapshot = taskSnapshotResponseSchema.parse(await transport<TaskSnapshotResponse>('/api/tasks/snapshot'));
          current(captured);
        }
        const visible = new Set(snapshot.lists.map((list) => list.id));
        for (const list of snapshot.lists) hiddenLists.delete(list.id);
        for (const id of Object.keys(state.items)) if (!visible.has(id)) hiddenLists.add(id);
        // Revocation takes effect even if the following durable write fails.
        emit({
          ...state,
          lists: snapshot.lists,
          items: Object.fromEntries(Object.entries(state.items).filter(([id]) => visible.has(id))),
        });
        // Replace the complete cache atomically, never a partial list response.
        const savedSnapshot = await updateTaskData(account, (data) => {
          current(captured);
          if (JSON.stringify(data.snapshot.items) !== before) return;
          data.snapshot = { account, lists: snapshot.lists, items: snapshot.items, syncedAt: Date.now() };
          const allowed = new Set(snapshot.lists.map((list) => list.id));
          if (data.operations.some((op) => !allowed.has(op.listId))) data.rejection = revokedTaskText;
          data.operations = data.operations.filter((op) => allowed.has(op.listId));
          data.discards = Object.fromEntries(
            Object.entries(data.discards).filter(([, entry]) => allowed.has(entry.listId)),
          );
          for (const { key } of awaitingRefresh) if (data.discards[key]) data.discards[key]!.requiresRefresh = false;
        });
        current(captured);
        emit({
          ...state,
          ...savedSnapshot.snapshot,
          pending: savedSnapshot.operations,
          error: savedSnapshot.rejection ?? state.error,
        });
      } catch (error) {
        if (captured === revision && isAccountCurrent(sessionToken)) {
          if (error instanceof ApiRequestError && [401, 403].includes(error.status)) {
            await clear();
            window.dispatchEvent(new Event('rodzina:session-lost'));
          } else if (!sessionConfirmed && error instanceof ApiRequestError && error.status === 404) {
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
