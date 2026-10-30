import '../../offline/testSetup.js';
import { IDBObjectStore } from 'fake-indexeddb';
import { expect, it, vi } from 'vitest';
import type { Task, TaskChecklistItem, TaskList } from '@rodzina/shared';
import { OFFLINE_REPLAY_MAX_AGE_MS } from '@rodzina/shared';
import { ApiRequestError } from '../../api.js';
import { closeDatabase, transact, clearDatabase } from '../../offline/database.js';
import { readOperations, completeOperation, appendOperation } from '../../offline/outbox.js';
import { joinSync } from '../../offline/sync.js';
import { createTaskOfflineStore, checklistProgress } from './taskOffline.js';
import { readTaskData, updateTaskData } from './taskStorage.js';
import { taskAdapter } from './taskAdapter.js';

const family = '10000000-0000-4000-8000-000000000001';
const user = '10000000-0000-4000-8000-000000000002';
const listId = '10000000-0000-4000-8000-000000000003';
const taskId = '10000000-0000-4000-8000-000000000004';
const first = '10000000-0000-4000-8000-000000000005';
const second = '10000000-0000-4000-8000-000000000006';
const account = `${family}:${user}`;
const list: TaskList = {
  id: listId,
  familyId: family,
  ownerId: user,
  memberIds: [],
  name: 'Dom',
  isDefault: true,
  position: 0,
  openTaskCount: 1,
  createdAt: 1,
  updatedAt: 1,
};
const task: Task = {
  id: taskId,
  listId,
  title: 'Porządki',
  notes: null,
  dueDate: null,
  dueTime: null,
  assigneeId: null,
  isDone: false,
  doneBy: null,
  doneAt: null,
  position: 0,
  createdBy: user,
  createdAt: 1,
  updatedAt: 1,
  checklist: [],
  checklistOrderVersion: 0,
};
const item = (id = first, extra: Partial<TaskChecklistItem> = {}): TaskChecklistItem => ({
  id,
  taskId,
  title: id === first ? 'Okna' : 'Podłoga',
  position: id === first ? 0 : 1,
  isDone: false,
  doneBy: null,
  doneAt: null,
  version: 0,
  doneVersion: 0,
  createdBy: user,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});
type Transport = <T>(path: string, init?: RequestInit) => Promise<T>;
async function fixture(initial: Task = task) {
  let tasks = [structuredClone(initial)];
  let lists = [list];
  let lose = false;
  let onMutation: (path: string, init: RequestInit) => unknown | Promise<unknown> = () => {
    throw new Error('Unexpected mutation');
  };
  const responses = new Map<string, unknown>();
  const request = vi.fn(async (path: string, init?: RequestInit): Promise<unknown> => {
    if (path === '/api/auth/me') return { family: { id: family }, user: { id: user } };
    if (path === '/api/tasks/lists') return { lists };
    if (path === '/api/tasks/snapshot')
      return { ok: true, lists, items: Object.fromEntries(lists.map((entry) => [entry.id, structuredClone(tasks)])) };
    if (!init?.method) {
      if (!tasks.length) throw new ApiRequestError('Usunięto zadanie', 404, 'NOT_FOUND');
      return { ok: true, items: tasks[0]!.checklist, orderVersion: tasks[0]!.checklistOrderVersion };
    }
    if (responses.has(path)) return responses.get(path);
    const result = await onMutation(path, init);
    responses.set(path, result);
    if (lose) {
      lose = false;
      throw new TypeError('Lost response');
    }
    return result;
  });
  const store = createTaskOfflineStore(request as Transport);
  await store.activate(account);
  await updateTaskData(account, (data) => {
    data.snapshot = { account, lists, items: { [listId]: structuredClone(tasks) } };
  });
  await store.reload();
  return {
    store,
    request,
    mutate: (action: typeof onMutation) => {
      onMutation = action;
    },
    reply: (items: TaskChecklistItem[], orderVersion: number) => {
      tasks = tasks.map((entry) => ({ ...entry, checklist: items, checklistOrderVersion: orderVersion }));
      return { ok: true, items, orderVersion };
    },
    setTasks: (next: Task[]) => {
      tasks = next;
    },
    revoke: () => {
      lists = [];
    },
    lose: () => {
      lose = true;
    },
  };
}
const projected = (store: ReturnType<typeof createTaskOfflineStore>, id = taskId) =>
  store.project().items[listId]!.find((entry) => entry.id === id)!;
async function retry() {
  await transact('readwrite', async (tx) => {
    for (const op of await readOperations(tx, account)) tx.objectStore('outbox').put({ ...op, nextAttemptAt: 0 });
  });
}

it('keeps legacy pending work and treats an absent checklist as unknown after reopening IDB', async () => {
  const legacy = { ...task };
  delete legacy.checklist;
  delete legacy.checklistOrderVersion;
  const f = await fixture(legacy);
  await f.store.enqueue(listId, taskId, { type: 'update', data: { title: 'Zapisane' } });
  const before = await readTaskData(account);
  await closeDatabase();
  const restored = createTaskOfflineStore(f.request as Transport);
  await restored.activate(account);
  expect(restored.getSnapshot().pending).toEqual(before.operations);
  expect(checklistProgress(projected(restored))).toBeUndefined();
  await expect(
    restored.enqueue(listId, taskId, { type: 'checklist-create', data: { id: first, title: 'Okna' } }),
  ).rejects.toThrow('pobrać pełną');
});

it('persists parent → item → edits → completion → order → removal in the shared outbox across restart', async () => {
  const f = await fixture();
  const parent = crypto.randomUUID();
  await f.store.enqueue(listId, parent, { type: 'create', data: { title: 'Nowe' } });
  await f.store.enqueue(listId, parent, { type: 'checklist-create', data: { id: first, title: 'Okna' } });
  await f.store.enqueue(listId, parent, {
    type: 'checklist-update',
    itemId: first,
    data: { title: 'Wszystkie okna', version: 0 },
  });
  await f.store.enqueue(listId, parent, {
    type: 'checklist-update',
    itemId: first,
    data: { isDone: true, doneVersion: 0 },
  });
  await f.store.enqueue(listId, parent, { type: 'checklist-order', data: { itemIds: [first], orderVersion: 1 } });
  const operations = await transact('readonly', (tx) => readOperations(tx, account));
  expect(operations[1]!.dependsOn).toContain(operations[0]!.operationId);
  expect(operations[2]!.dependsOn).toContain(operations[1]!.operationId);
  expect(operations.every((op) => op.module === 'tasks')).toBe(true);
  expect(checklistProgress(projected(f.store, parent))).toEqual({ done: 1, total: 1 });
  expect(projected(f.store, parent).isDone).toBe(false);
  await closeDatabase();
  const restored = createTaskOfflineStore(f.request as Transport);
  await restored.activate(account);
  expect(projected(restored, parent).checklist![0]).toMatchObject({
    title: 'Wszystkie okna',
    version: 1,
    doneVersion: 1,
    doneBy: user,
  });
  let step = 0;
  f.mutate((path, init) => {
    const data = JSON.parse(String(init.body));
    const rows = [{ ...task, id: parent, title: 'Nowe' }];
    if (step++ === 0) {
      expect(path).toContain(`taskId=${parent}`);
      f.setTasks(rows);
      return { ok: true, task: rows[0] };
    }
    expect(path).toContain(`/api/tasks/${parent}/checklist`);
    if (step === 2) {
      expect(data).toEqual({ id: first, title: 'Okna' });
      return f.reply([item(first, { taskId: parent })], 1);
    }
    if (step === 3) {
      expect(data).toEqual({ title: 'Wszystkie okna', version: 0 });
      return f.reply([item(first, { taskId: parent, title: data.title, version: 1 })], 1);
    }
    if (step === 4) {
      expect(data).toEqual({ isDone: true, doneVersion: 0 });
      return f.reply(
        [
          item(first, {
            taskId: parent,
            title: 'Wszystkie okna',
            version: 1,
            isDone: true,
            doneVersion: 1,
            doneBy: user,
            doneAt: 2,
          }),
        ],
        1,
      );
    }
    if (step === 5) {
      expect(data).toEqual({ itemIds: [first], orderVersion: 1 });
      return f.reply([item(first, { taskId: parent, version: 1, doneVersion: 1 })], 2);
    }
    expect(init.method).toBe('DELETE');
    expect(data).toEqual({ version: 1, doneVersion: 1 });
    return f.reply([], 3);
  });
  await restored.synchronize();
  expect(restored.getSnapshot().pending).toEqual([]);
  await restored.enqueue(listId, parent, {
    type: 'checklist-remove',
    itemId: first,
    data: { version: 1, doneVersion: 1 },
  });
  await restored.synchronize();
  expect(restored.getSnapshot().pending).toEqual([]);
  expect(projected(restored, parent).checklist).toEqual([]);
});

it('merges simultaneous tabs without losing pending items or confirmed snapshot fields', async () => {
  const f = await fixture();
  const other = createTaskOfflineStore(f.request as Transport);
  await other.activate(account);
  await Promise.all([
    f.store.enqueue(listId, taskId, { type: 'checklist-create', data: { id: first, title: 'Okna' } }),
    other.enqueue(listId, taskId, { type: 'checklist-create', data: { id: second, title: 'Podłoga' } }),
  ]);
  await f.store.reload();
  expect(projected(f.store).checklist).toHaveLength(2);
  expect((await readTaskData(account)).snapshot.items[listId]![0]!.checklist).toEqual([]);
});

it('does not confirm a mutation before durable commit and rolls back cache plus acknowledgement together', async () => {
  const f = await fixture();
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
    throw new DOMException('Quota', 'QuotaExceededError');
  });
  await expect(
    f.store.enqueue(listId, taskId, { type: 'checklist-create', data: { id: first, title: 'Okna' } }),
  ).rejects.toThrow();
  failure.mockRestore();
  expect(projected(f.store).checklist).toEqual([]);
  expect((await readTaskData(account)).operations).toEqual([]);
  await f.store.enqueue(listId, taskId, { type: 'checklist-create', data: { id: first, title: 'Okna' } });
  f.mutate(() => {
    const original = IDBObjectStore.prototype.delete;
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, key) {
      if (this.name === 'outbox') throw new Error('Acknowledgement failed');
      return original.call(this, key);
    });
    return f.reply([item()], 1);
  });
  await f.store.synchronize();
  vi.restoreAllMocks();
  expect((await readTaskData(account)).operations).toHaveLength(1);
  await retry();
  await f.store.synchronize();
  expect((await readTaskData(account)).operations).toEqual([]);
  expect(projected(f.store).checklist).toHaveLength(1);
});

it('retries the same operation after a lost response without creating a second item', async () => {
  const f = await fixture();
  await f.store.enqueue(listId, taskId, { type: 'checklist-create', data: { id: first, title: 'Okna' } });
  f.mutate(() => f.reply([item()], 1));
  f.lose();
  await f.store.synchronize();
  expect(f.store.getSnapshot().pending).toHaveLength(1);
  await closeDatabase();
  const restored = createTaskOfflineStore(f.request as Transport);
  await restored.activate(account);
  await retry();
  await restored.synchronize();
  const writes = f.request.mock.calls.filter(([, init]) => init?.method);
  expect(writes[0]![0]).toBe(writes[1]![0]);
  expect(restored.getSnapshot().pending).toEqual([]);
  expect(projected(restored).checklist).toHaveLength(1);
});

it.each(['title', 'order'] as const)(
  'keeps a %s conflict for explicit resolution while syncing another item',
  async (field) => {
    const f = await fixture({ ...task, checklist: [item(), item(second)] });
    await f.store.enqueue(
      listId,
      taskId,
      field === 'title'
        ? { type: 'checklist-update', itemId: first, data: { title: 'Moja zmiana', version: 0 } }
        : { type: 'checklist-order', data: { itemIds: [second, first], orderVersion: 0 } },
    );
    await f.store.enqueue(listId, taskId, {
      type: 'checklist-update',
      itemId: second,
      data: { isDone: true, doneVersion: 0 },
    });
    f.mutate((path) => {
      if (!path.includes(`/checklist/${second}?`)) throw new ApiRequestError('Konflikt', 409, 'CHECKLIST_CONFLICT');
      return f.reply(
        [item(first, { title: 'Zmiana na serwerze', version: 1 }), item(second, { isDone: true, doneVersion: 1 })],
        1,
      );
    });
    await f.store.synchronize();
    expect(f.store.getSnapshot().pending).toHaveLength(1);
    expect(f.store.project().pending[0]).toMatchObject({ status: 'needs-review', reason: 'conflict' });
    expect(projected(f.store).checklist![1]!.isDone).toBe(true);
    await expect(
      f.store.enqueue(
        listId,
        taskId,
        field === 'title'
          ? { type: 'checklist-update', itemId: first, data: { title: 'Jeszcze raz', version: 1 } }
          : { type: 'checklist-order', data: { itemIds: [first, second], orderVersion: 1 } },
      ),
    ).rejects.toThrow('Najpierw sprawdź');
    await f.store.discardReview(f.store.project().pending.map((op) => op.id));
    await f.store.synchronize();
    expect(projected(f.store).checklist![0]!.title).toBe('Zmiana na serwerze');
  },
);

it('does not resurrect a deleted parent and preserves the parent when only an item was deleted', async () => {
  const f = await fixture({ ...task, checklist: [item()] });
  await f.store.enqueue(listId, taskId, {
    type: 'checklist-update',
    itemId: first,
    data: { isDone: true, doneVersion: 0 },
  });
  f.setTasks([{ ...task, checklist: [] }]);
  f.mutate(() => {
    throw new ApiRequestError('Brak kroku', 404, 'NOT_FOUND');
  });
  await f.store.synchronize();
  expect(projected(f.store)).toBeDefined();
  expect(f.store.project().pending[0]!.status).toBe('needs-review');
  await f.store.discardReview(f.store.project().pending.map((op) => op.id));
  await f.store.synchronize();
  await f.store.enqueue(listId, taskId, { type: 'checklist-create', data: { id: second, title: 'Podłoga' } });
  f.setTasks([]);
  await f.store.synchronize();
  expect(f.store.project().items[listId]).toEqual([]);
  expect(f.store.project().pending[0]!.status).toBe('needs-review');
  expect(
    f.request.mock.calls.filter(([path, init]) => init?.method === 'POST' && !path.includes('/checklist')),
  ).toEqual([]);
});

it('keeps expired item changes and their dependents for review across clock correction', async () => {
  const f = await fixture();
  await f.store.enqueue(listId, taskId, { type: 'checklist-create', data: { id: first, title: 'Okna' } });
  await f.store.enqueue(listId, taskId, {
    type: 'checklist-update',
    itemId: first,
    data: { isDone: true, doneVersion: 0 },
  });
  await updateTaskData(account, (data) => {
    data.operations[0]!.submittedAt = Date.now() - OFFLINE_REPLAY_MAX_AGE_MS - 1;
  });
  await f.store.reload();
  expect(f.store.project().pending.map((op) => op.reason)).toEqual(['expired', 'dependency']);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1);
  try {
    await f.store.reload();
    expect(f.store.project().pending.map((op) => op.reason)).toEqual(['expired', 'dependency']);
  } finally {
    clock.mockRestore();
  }
  await f.store.synchronize();
  expect(f.request.mock.calls.filter(([, init]) => init?.method)).toEqual([]);
});

it('removes revoked content and its checklist operations before replay', async () => {
  const f = await fixture();
  await f.store.enqueue(listId, taskId, { type: 'checklist-create', data: { id: first, title: 'Okna' } });
  f.revoke();
  await f.store.synchronize();
  expect(f.store.project().items).toEqual({});
  expect((await readTaskData(account)).operations).toEqual([]);
  expect(f.request.mock.calls.filter(([, init]) => init?.method)).toEqual([]);
});

it('ignores a late checklist response after logout and switching accounts', async () => {
  const f = await fixture();
  await f.store.enqueue(listId, taskId, { type: 'checklist-create', data: { id: first, title: 'Okna' } });
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.mutate(async () => {
    entered();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return f.reply([item()], 1);
  });
  const syncing = f.store.synchronize();
  await started;
  f.store.clear(false);
  await clearDatabase();
  await f.store.activate('another:account');
  release();
  await syncing;
  expect(f.store.project()).toMatchObject({ account: 'another:account', items: {}, pending: [] });
  expect((await readTaskData('another:account')).operations).toEqual([]);
  expect((await readTaskData('another:account')).snapshot.items).toEqual({});
});

it('aborts checklist reconciliation and queue acknowledgement as one IDB transaction', async () => {
  const f = await fixture();
  await f.store.enqueue(listId, taskId, { type: 'checklist-create', data: { id: first, title: 'Okna' } });
  const before = await readTaskData(account);
  await expect(
    transact('readwrite', async (tx) => {
      const operations = await readOperations(tx, account);
      await taskAdapter(account).reconcile(tx, operations[0]!, { ok: true, items: [item()], orderVersion: 1 });
      completeOperation(tx, operations, operations[0]!);
      throw new Error('Interrupted before commit');
    }),
  ).rejects.toThrow('Interrupted');
  expect(await readTaskData(account)).toEqual(before);
});

it('projects independent title and completion edits and validates limits, order and missing items', async () => {
  const f = await fixture({ ...task, checklist: [item(), item(second)] });
  await f.store.enqueue(listId, taskId, {
    type: 'checklist-update',
    itemId: first,
    data: { isDone: true, doneVersion: 0 },
  });
  await f.store.enqueue(listId, taskId, {
    type: 'checklist-update',
    itemId: first,
    data: { title: 'Wszystkie okna', version: 0 },
  });
  await f.store.enqueue(listId, taskId, {
    type: 'checklist-order',
    data: { itemIds: [second, first], orderVersion: 0 },
  });
  expect(projected(f.store).checklist!.map((entry) => [entry.id, entry.position])).toEqual([
    [second, 0],
    [first, 1],
  ]);
  expect(projected(f.store).checklist![1]).toMatchObject({
    title: 'Wszystkie okna',
    isDone: true,
    doneVersion: 1,
    version: 1,
  });
  await f.store.enqueue(listId, taskId, {
    type: 'checklist-update',
    itemId: first,
    data: { isDone: false, doneVersion: 1 },
  });
  expect(projected(f.store).checklist![1]).toMatchObject({ doneBy: null, doneAt: null });
  await expect(
    f.store.enqueue(listId, taskId, { type: 'checklist-order', data: { itemIds: [first], orderVersion: 1 } }),
  ).rejects.toThrow('Kolejność');
  await expect(
    f.store.enqueue(listId, taskId, {
      type: 'checklist-update',
      itemId: first,
      data: { title: 'Stara wersja', version: 0 },
    }),
  ).rejects.toThrow('wymaga sprawdzenia');
  await expect(
    f.store.enqueue(listId, taskId, {
      type: 'checklist-remove',
      itemId: crypto.randomUUID(),
      data: { version: 0, doneVersion: 0 },
    }),
  ).rejects.toThrow('nie istnieje');
  await expect(
    f.store.enqueue(listId, taskId, { type: 'checklist-create', data: { id: first, title: 'Duplikat' } }),
  ).rejects.toThrow('powtórzony');
  await updateTaskData(account, (data) => {
    data.operations = [];
    data.snapshot.items[listId]![0]!.checklist = Array.from({ length: 100 }, (_, position) =>
      item(crypto.randomUUID(), { position }),
    );
  });
  await expect(
    f.store.enqueue(listId, taskId, { type: 'checklist-create', data: { id: first, title: '101' } }),
  ).rejects.toThrow('limit');
});

it('allows another field to synchronize when a title edit conflicts', async () => {
  const f = await fixture({ ...task, checklist: [item()] });
  await f.store.enqueue(listId, taskId, {
    type: 'checklist-update',
    itemId: first,
    data: { title: 'Moja zmiana', version: 0 },
  });
  await f.store.enqueue(listId, taskId, {
    type: 'checklist-update',
    itemId: first,
    data: { isDone: true, doneVersion: 0 },
  });
  f.mutate((_path, init) => {
    if ('title' in JSON.parse(String(init.body))) throw new ApiRequestError('Konflikt', 409, 'CHECKLIST_CONFLICT');
    return f.reply([item(first, { title: 'Inne urządzenie', version: 1, isDone: true, doneVersion: 1 })], 0);
  });
  await f.store.synchronize();
  expect(f.store.project().pending).toHaveLength(1);
  expect(checklistProgress(projected(f.store))).toEqual({ done: 1, total: 1 });
  expect(projected(f.store).checklist![0]!.title).toBe('Inne urządzenie');
});

it('keeps pending projection over a full snapshot while preserving unrelated server changes', async () => {
  const f = await fixture({ ...task, checklist: [item()] });
  await f.store.enqueue(listId, taskId, {
    type: 'checklist-update',
    itemId: first,
    data: { title: 'Moja zmiana', version: 0 },
  });
  f.setTasks([
    {
      ...task,
      notes: 'Z drugiego urządzenia',
      checklist: [item(first, { title: 'Z serwera', version: 1 }), item(second)],
    },
  ]);
  f.mutate(() => {
    throw new ApiRequestError('Awaria', 500, 'UNAVAILABLE');
  });
  await f.store.synchronize();
  expect(projected(f.store)).toMatchObject({ notes: 'Z drugiego urządzenia' });
  expect(projected(f.store).checklist!.map((entry) => entry.title)).toEqual(['Moja zmiana', 'Podłoga']);
  expect(f.store.project().pending).toHaveLength(1);
});

it('does not increment projected versions twice when a snapshot includes an unacknowledged completion', async () => {
  const f = await fixture({ ...task, checklist: [item()] });
  await f.store.enqueue(listId, taskId, {
    type: 'checklist-update',
    itemId: first,
    data: { isDone: true, doneVersion: 0 },
  });
  f.mutate(() => f.reply([item(first, { isDone: true, doneVersion: 1, doneBy: user, doneAt: 2 })], 0));
  f.lose();
  await f.store.synchronize();
  expect(projected(f.store).checklist![0]!.doneVersion).toBe(1);
  await f.store.enqueue(listId, taskId, {
    type: 'checklist-update',
    itemId: first,
    data: { isDone: false, doneVersion: 1 },
  });
  expect(projected(f.store).checklist![0]!.doneVersion).toBe(2);
});

it('sends checklist and shopping changes through the same account outbox', async () => {
  const f = await fixture();
  await f.store.enqueue(listId, taskId, { type: 'checklist-create', data: { id: first, title: 'Okna' } });
  const shoppingId = crypto.randomUUID();
  await transact('readwrite', (tx) =>
    appendOperation(tx, account, 'shopping', {
      operationId: shoppingId,
      submittedAt: Date.now(),
      entityId: 'milk',
      orderingKeys: ['shopping:milk'],
      payload: { name: 'Mleko' },
    }),
  );
  const send = vi.fn(async () => ({}));
  const sender = joinSync(
    account,
    { module: 'shopping', prepare: async () => {}, send, reconcile: async () => {}, invalidateAccess: async () => {} },
    () => {},
  );
  f.mutate(() => f.reply([item()], 1));
  try {
    await f.store.synchronize();
    expect(send).toHaveBeenCalledOnce();
    expect(await transact('readonly', (tx) => readOperations(tx, account))).toEqual([]);
    expect(projected(f.store).checklist).toHaveLength(1);
  } finally {
    sender.stop();
  }
});
