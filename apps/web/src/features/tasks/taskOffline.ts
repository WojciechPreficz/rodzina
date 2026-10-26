import { z } from 'zod';
import {
  taskListSchema,
  taskSchema,
  createTaskSchema,
  patchTaskSchema,
  type PatchTask,
  type Task,
  type TaskList,
} from '@rodzina/shared';
import { apiFetch, ApiRequestError } from '../../api.js';
import { assertOfflineReplayAge, OfflineOperationExpiredError } from '@rodzina/shared';

export const TASK_STORAGE_KEY = 'rodzina:tasks:v1';
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
const operationSchema = z.object({
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
const discardSchema = z.object({
  operationIds: z.array(z.string().uuid()),
  listId: z.string(),
  requiresRefresh: z.boolean(),
});

// Classification also runs offline, before replay can persist the new status.
// A clock correction must never revive an operation already marked for review.
function classify(operations: TaskOperation[]): TaskOperation[] {
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

export function taskOperationBlocksAlarm(op: TaskOperation) {
  return (
    op.change.type === 'remove' ||
    (op.change.type === 'update' &&
      (op.change.data.isDone !== undefined ||
        op.change.data.dueDate !== undefined ||
        op.change.data.dueTime !== undefined))
  );
}
const snapshotSchema = z.object({
  account: z.string(),
  lists: z.array(taskListSchema).optional(),
  items: z.record(z.array(taskSchema)),
  syncedAt: z.number().optional(),
});
type Snapshot = z.infer<typeof snapshotSchema>;
export type TaskOfflineState = Snapshot & { pending: TaskOperation[]; error?: string | undefined; syncing: boolean };
type Transport = <T>(path: string, init?: RequestInit) => Promise<T>;
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Nie udało się zsynchronizować zadań.');
const storageError = () =>
  new Error(
    'Nie można zapisać zadań na urządzeniu. Zwolnij miejsce lub włącz pamięć przeglądarki. Zmiana nie została przyjęta.',
  );

// The journal is authoritative; each operation has its own key so another tab
// cannot overwrite pending work. Cache and confirmed responses are separate.
export function createTaskOfflineStore(transport: Transport = apiFetch, storage: () => Storage = () => localStorage) {
  let state: TaskOfflineState = { account: '', items: {}, pending: [], syncing: false };
  let revision = 0;
  let running: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const emit = (next: TaskOfflineState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  const prefix = (account = state.account) => `${TASK_STORAGE_KEY}:operation:${account}:`;
  const discardPrefix = () => `${TASK_STORAGE_KEY}:discard:${state.account}:`;
  const discards = () =>
    Object.keys(storage())
      .filter((key) => key.startsWith(discardPrefix()))
      .map((key) => ({ key, ...discardSchema.parse(JSON.parse(storage().getItem(key)!)) }));
  const journal = () => {
    const discarded = new Set(discards().flatMap((entry) => entry.operationIds));
    return classify(
      Object.keys(storage())
        .filter((key) => key.startsWith(prefix()))
        .map((key) => operationSchema.parse(JSON.parse(storage().getItem(key)!)))
        .filter((op) => !discarded.has(op.id))
        .sort((a, b) => a.submittedAt - b.submittedAt || a.id.localeCompare(b.id)),
    );
  };
  const persistReviews = (operations: TaskOperation[]) => {
    let issue: string | undefined;
    for (const op of operations) {
      if (op.status !== 'needs-review') continue;
      try {
        const key = `${prefix()}${op.id}`;
        const saved = operationSchema.parse(JSON.parse(storage().getItem(key)!));
        if (saved.status !== op.status || saved.reason !== op.reason) storage().setItem(key, JSON.stringify(op));
      } catch {
        issue = storageError().message;
      }
    }
    return issue;
  };
  const persist = (next: Snapshot) => {
    try {
      storage().setItem(TASK_STORAGE_KEY, JSON.stringify(next));
    } catch {
      throw storageError();
    }
  };
  const current = (captured: number) => {
    if (captured !== revision) throw new DOMException('Session changed', 'AbortError');
  };
  function activate(account: string) {
    if (state.account === account) return;
    if (state.account) clear();
    revision++;
    running = undefined;
    let saved: Snapshot = { account, items: {} };
    let issue: string | undefined;
    try {
      const raw = storage().getItem(TASK_STORAGE_KEY);
      const parsed = snapshotSchema.safeParse(JSON.parse(raw ?? 'null'));
      if (parsed.success && parsed.data.account === account) saved = parsed.data;
      else if (raw && !parsed.success)
        issue = 'Nie można odczytać zapisanych zadań. Połącz się z internetem, aby pobrać je ponownie.';
    } catch {
      issue = 'Nie można odczytać zapisanych zadań. Połącz się z internetem, aby pobrać je ponownie.';
    }
    emit({ ...saved, pending: [], syncing: false, error: issue });
    try {
      const pending = journal();
      emit({ ...state, pending, error: persistReviews(pending) ?? state.error });
    } catch {
      emit({ ...state, error: 'Nie można odczytać kolejki zadań. Niektóre zmiany wymagają sprawdzenia.' });
    }
  }
  function clear(removeStored = true) {
    revision++;
    running = undefined;
    if (removeStored) {
      try {
        storage().removeItem(TASK_STORAGE_KEY);
        for (const key of Object.keys(storage())) if (key.startsWith(`${TASK_STORAGE_KEY}:`)) storage().removeItem(key);
      } catch {
        /* Disabled storage cannot be read by the next session. */
      }
    }
    emit({ account: '', items: {}, pending: [], syncing: false });
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
  function enqueue(listId: string, taskId: string, change: TaskOperation['change']) {
    if (!state.account || !state.lists?.some((list) => list.id === listId) || !state.items[listId])
      throw new Error(taskOfflineText.empty);
    if (journal().some((op) => op.listId === listId && op.taskId === taskId && op.status === 'needs-review'))
      throw new Error(taskOfflineText.blocked);
    if (discards().some((entry) => entry.listId === listId && entry.requiresRefresh))
      throw new Error('Po odrzuceniu zmian połącz się z internetem i odśwież listę przed nowym zapisem.');
    const op = operationSchema.parse({
      id: crypto.randomUUID(),
      submittedAt: Math.max(Date.now(), (state.pending.at(-1)?.submittedAt ?? 0) + 1),
      listId,
      taskId,
      change,
    });
    try {
      // Save the base before the journal: a killed process can restore both.
      persist({ account: state.account, lists: state.lists, items: state.items, syncedAt: state.syncedAt });
      storage().setItem(`${prefix()}${op.id}`, JSON.stringify(op));
    } catch {
      throw storageError();
    }
    emit({ ...state, pending: journal(), error: undefined });
    return project().items[listId]?.find((task) => task.id === taskId);
  }
  function discardReview(operationIds: string[]) {
    const operations = journal();
    const first = operations.find((op) => op.id === operationIds[0]);
    const chain = first && operations.filter((op) => op.listId === first.listId && op.taskId === first.taskId);
    if (
      !chain?.length ||
      chain.some((op) => op.status !== 'needs-review') ||
      chain.length !== operationIds.length ||
      chain.some((op, index) => op.id !== operationIds[index])
    )
      throw new Error('Lista zmian uległa zmianie. Otwórz ją ponownie przed odrzuceniem.');
    try {
      // One durable write discards the entire inspected chain, even if cleanup fails.
      storage().setItem(
        `${discardPrefix()}${crypto.randomUUID()}`,
        JSON.stringify({ operationIds, listId: first!.listId, requiresRefresh: true }),
      );
    } catch {
      throw storageError();
    }
    for (const id of operationIds) {
      try {
        storage().removeItem(`${prefix()}${id}`);
      } catch {
        /* The discard marker remains authoritative. */
      }
    }
    emit({ ...state, pending: journal(), error: undefined });
    window.dispatchEvent(new Event('rodzina:tasks-changed'));
  }
  async function synchronize() {
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
          clear();
          window.dispatchEvent(new Event('rodzina:session-lost'));
          return;
        }
        // Access is refreshed before replay, including retries with saved responses.
        const { lists } = await transport<{ lists: TaskList[] }>('/api/tasks/lists');
        current(captured);
        const allowed = new Set(lists.map((list) => list.id));
        alarmsChanged = journal().length > 0;
        const revoked = journal().filter((op) => !allowed.has(op.listId));
        const items = Object.fromEntries(Object.entries(state.items).filter(([id]) => allowed.has(id)));
        // Revoked content must leave the UI even if local storage has failed.
        emit({ ...state, lists, items, pending: state.pending.filter((op) => allowed.has(op.listId)) });
        persist({ account, lists, items });
        for (const op of revoked) storage().removeItem(`${prefix(account)}${op.id}`);
        emit({
          ...state,
          lists,
          items,
          pending: journal(),
          error: revoked.length ? 'Utracono dostęp do listy. Jej oczekujące zmiany nie zostały wysłane.' : undefined,
        });
        try {
          for (const queued of journal()) {
            const op = journal().find((entry) => entry.id === queued.id);
            if (!op) continue;
            if (op.status === 'needs-review') {
              emit({ ...state, pending: journal() });
              try {
                storage().setItem(`${prefix(account)}${op.id}`, JSON.stringify(op));
              } catch {
                emit({ ...state, error: storageError().message });
              }
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
              persist(next);
              storage().removeItem(`${prefix(account)}${op.id}`);
              emit({ ...state, ...next, pending: journal() });
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
              storage().removeItem(`${prefix(account)}${op.id}`);
              emit({
                ...state,
                pending: journal(),
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
            const awaitingRefresh = discards().filter((entry) => entry.listId === list.id && entry.requiresRefresh);
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
            persist(next);
            for (const { key, ...entry } of awaitingRefresh)
              storage().setItem(key, JSON.stringify({ ...entry, requiresRefresh: false }));
            emit({ ...state, ...next });
          } catch (error) {
            current(captured);
            if (error instanceof ApiRequestError && [403, 404].includes(error.status)) {
              const nextItems = { ...state.items };
              delete nextItems[list.id];
              const next = { account, lists: state.lists?.filter((entry) => entry.id !== list.id), items: nextItems };
              const revoked = journal().filter((op) => op.listId === list.id);
              emit({
                ...state,
                ...next,
                pending: state.pending.filter((op) => op.listId !== list.id),
                error: 'Utracono dostęp do listy zadań.',
              });
              persist(next);
              for (const op of revoked) storage().removeItem(`${prefix(account)}${op.id}`);
            } else throw error;
          }
        }
      } catch (error) {
        if (captured === revision) {
          if (error instanceof ApiRequestError && [401, 403].includes(error.status)) {
            clear();
            window.dispatchEvent(new Event('rodzina:session-lost'));
          } else if (error instanceof ApiRequestError && error.status === 404) {
            const next = { account, lists: [], items: {} };
            emit({ ...state, ...next, error: errorText(error) });
            try {
              persist(next);
            } catch {
              emit({ ...state, error: storageError().message });
            }
          } else emit({ ...state, error: errorText(error) });
        }
      } finally {
        if (captured === revision) {
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
    reload: () => {
      if (state.account) {
        try {
          const pending = journal();
          emit({ ...state, pending, error: persistReviews(pending) ?? state.error });
          window.dispatchEvent(new Event('rodzina:tasks-changed'));
        } catch {
          emit({ ...state, error: 'Nie można odczytać kolejki zadań. Niektóre zmiany wymagają sprawdzenia.' });
        }
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
