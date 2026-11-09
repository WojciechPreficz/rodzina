import { readOperations, closeDatabase, transact } from '../../offline/testing.js';
import { IDBObjectStore } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { onlineManager } from '@tanstack/react-query';
import { OFFLINE_REPLAY_MAX_AGE_MS, type Task, type TaskList } from '@rodzina/shared';
import { ApiRequestError } from '../../api.js';
import { createTaskOfflineStore } from './taskOffline.js';
import { readTaskData, updateTaskData } from './taskStorage.js';
import { pendingTaskSuccessor } from './taskRecurrenceOffline.js';
import { taskAdapter } from './taskAdapter.js';

const family = '10000000-0000-4000-8000-000000000001';
const user = '10000000-0000-4000-8000-000000000002';
const listId = '10000000-0000-4000-8000-000000000003';
const taskId = '10000000-0000-4000-8000-000000000004';
const seriesId = '10000000-0000-4000-8000-000000000005';
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
  dueDate: '2026-10-20',
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
  recurrence: {
    seriesId,
    seriesVersion: 0,
    sequence: 0,
    version: 0,
    plannedDate: '2026-10-20',
    plannedTime: null,
    state: 'active',
    closedAt: null,
    closedBy: null,
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
});

async function fixture() {
  onlineManager.setOnline(false);
  let tasks = structuredClone([task]);
  let lists = [list];
  let failure: Error | undefined;
  let lose = false;
  let failSnapshot = false;
  const receipts = new Map<string, unknown>();
  const transport = vi.fn(async (path: string, init?: RequestInit): Promise<unknown> => {
    if (path === '/api/auth/me') return { family: { id: family }, user: { id: user } };
    if (path === '/api/tasks/lists') return { lists };
    if (path === '/api/tasks/snapshot') {
      if (failSnapshot) throw new TypeError('Snapshot unavailable');
      return structuredClone({ ok: true, lists, items: lists.length ? { [listId]: tasks } : {} });
    }
    if (failure) throw failure;
    if (receipts.has(path)) return structuredClone(receipts.get(path));
    const data = JSON.parse(String(init!.body));
    const current = tasks.find((t) => t.id === taskId)!;
    const r = current.recurrence!;
    if (data.expectedOccurrenceVersion !== r.version || data.expectedSeriesVersion !== r.seriesVersion)
      throw new ApiRequestError('Konflikt wersji', 409, 'TASK_RECURRENCE_CONFLICT');
    const updated: Task = {
      ...current,
      isDone: data.isDone,
      doneAt: data.isDone ? data.closedAt : null,
      doneBy: data.isDone ? user : null,
      recurrence: {
        ...r,
        version: r.version + 1,
        seriesVersion: r.seriesVersion! + 1,
        state: data.isDone ? 'done' : 'active',
        closedAt: data.isDone ? data.closedAt : null,
        closedBy: data.isDone ? user : null,
      },
    };
    tasks = data.isDone
      ? [updated, { ...task, id: crypto.randomUUID(), recurrence: { ...r, sequence: 1, seriesVersion: 1 } }]
      : [updated];
    // The compatibility response intentionally contains only the parent.
    const result = { task: updated };
    receipts.set(path, structuredClone(result));
    if (lose) {
      lose = false;
      throw new TypeError('Lost response');
    }
    return result;
  });
  const request = transport as <T>(path: string, init?: RequestInit) => Promise<T>;
  const store = createTaskOfflineStore(request);
  await store.activate(account);
  await updateTaskData(account, (data) => {
    data.snapshot = { account, lists, items: { [listId]: structuredClone(tasks) } };
  });
  await store.reload();
  return {
    store,
    request,
    transport,
    tasks: () => tasks,
    receipts,
    reject: (error?: Error) => {
      failure = error;
    },
    lose: () => {
      lose = true;
    },
    snapshots: (fail: boolean) => {
      failSnapshot = fail;
    },
    revoke: () => {
      lists = [];
    },
  };
}
async function retry() {
  await transact('readwrite', async (tx) => {
    for (const op of await readOperations(tx, account)) tx.objectStore('outbox').put({ ...op, nextAttemptAt: 0 });
  });
}

it('durably captures occurrence identity and actual UTC time, restores after restart and suppresses alarms', async () => {
  const f = await fixture();
  const before = Date.now();
  await f.store.enqueue(listId, taskId, { type: 'update', data: { isDone: true } });
  const op = (await readTaskData(account))!.operations[0]!;
  expect(op.occurrence).toEqual({ seriesId, sequence: 0, version: 0, seriesVersion: 0 });
  expect(op.change).toMatchObject({
    data: {
      closedAt: expect.any(Number),
      expectedSeriesId: seriesId,
      expectedOccurrenceVersion: 0,
      expectedSeriesVersion: 0,
    },
  });
  expect(op.change.type === 'update' && op.change.data.closedAt).toBeGreaterThanOrEqual(before);
  await closeDatabase();
  const restored = createTaskOfflineStore(f.request);
  await restored.activate(account);
  expect(restored.getSnapshot().pending).toEqual([op]);
  expect(restored.getSnapshot().items[listId]).toHaveLength(1);
  expect(pendingTaskSuccessor(restored.getSnapshot().items[listId]!, restored.getSnapshot().pending)).toBe(true);
  expect(restored.blockedTasks(account)).toEqual([taskId]);
  vi.spyOn(Date, 'now').mockReturnValue(before + 3 * 86400000);
  onlineManager.setOnline(true);
  await restored.synchronize();
  expect(restored.getSnapshot().pending).toEqual([]);
  expect(restored.getSnapshot().items[listId]).toHaveLength(2);
  expect(f.tasks()[0]!.doneAt).toEqual(op.change.type === 'update' && op.change.data.closedAt);
  expect(restored.blockedTasks(account)).toEqual([]);
});

it('reopens locally before sending and replays deterministic close/undo versions without leaving a successor', async () => {
  const f = await fixture();
  await f.store.enqueue(listId, taskId, { type: 'update', data: { isDone: true } });
  await f.store.enqueue(listId, taskId, { type: 'update', data: { isDone: false } });
  expect(f.store.getSnapshot().items[listId]).toMatchObject([
    { isDone: false, doneAt: null, recurrence: { state: 'active', version: 2, seriesVersion: 2 } },
  ]);
  expect(pendingTaskSuccessor(f.store.getSnapshot().items[listId]!, f.store.getSnapshot().pending)).toBe(false);
  expect(f.store.getSnapshot().pending[1]!.change).toMatchObject({
    data: { expectedSeriesVersion: 1, expectedOccurrenceVersion: 1 },
  });
  onlineManager.setOnline(true);
  await f.store.synchronize();
  expect(f.store.getSnapshot().pending).toEqual([]);
  expect(f.tasks()).toMatchObject([{ isDone: false, recurrence: { version: 2 } }]);
});

it.each(['response', 'snapshot'] as const)(
  'retries a lost %s with the same payload and atomically ACKs a complete snapshot',
  async (lost) => {
    const f = await fixture();
    await f.store.enqueue(listId, taskId, { type: 'update', data: { isDone: true } });
    if (lost === 'response') f.lose();
    else {
      const original = f.transport.getMockImplementation()!;
      f.transport.mockImplementation(async (path, init) => {
        const result = await original(path, init);
        if (init?.method) f.snapshots(true);
        return result;
      });
    }
    onlineManager.setOnline(true);
    await f.store.synchronize();
    expect((await readTaskData(account))!.operations).toHaveLength(1);
    expect((await readTaskData(account))!.snapshot.items[listId]).toMatchObject([{ isDone: false }]);
    expect(f.receipts.size).toBe(1);
    f.snapshots(false);
    const impl = f.transport.getMockImplementation()!;
    if (lost === 'snapshot')
      f.transport.mockImplementation(async (path, init) => {
        const result = await impl(path, init);
        f.snapshots(false);
        return result;
      });
    await retry();
    await f.store.synchronize();
    expect(f.store.getSnapshot().pending).toEqual([]);
    expect(f.receipts.size).toBe(1);
    expect(f.store.getSnapshot().items[listId]).toHaveLength(2);
    const writes = f.transport.mock.calls.filter(([, init]) => init?.method);
    expect(writes).toHaveLength(2);
    expect(writes[0]![0]).toEqual(writes[1]![0]);
    expect(writes[0]![1]!.body).toEqual(writes[1]![1]!.body);
  },
);

it.each(['TASK_RECURRENCE_CONFLICT', 'TASK_CLOSURE_TIME_REVIEW', 'NOT_FOUND'])(
  'preserves %s for review and blocks later changes',
  async (code) => {
    const f = await fixture();
    await f.store.enqueue(listId, taskId, { type: 'update', data: { isDone: true } });
    await f.store.enqueue(listId, taskId, { type: 'update', data: { isDone: false } });
    f.reject(new ApiRequestError('Wymaga sprawdzenia', code === 'NOT_FOUND' ? 404 : 409, code));
    onlineManager.setOnline(true);
    await f.store.synchronize();
    expect(f.store.getSnapshot().pending.map((op) => op.reason)).toEqual([
      code === 'NOT_FOUND' ? 'rejected' : 'conflict',
      'dependency',
    ]);
    expect(f.receipts.size).toBe(0);
    expect(f.store.blockedTasks(account)).toHaveLength(2);
  },
);

it('never acknowledges completion or changes projection when the durable enqueue fails', async () => {
  const f = await fixture();
  const fail = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
    throw new Error('Quota');
  });
  await expect(f.store.enqueue(listId, taskId, { type: 'update', data: { isDone: true } })).rejects.toThrow('Quota');
  fail.mockRestore();
  expect(f.store.getSnapshot().items[listId]![0]!.isDone).toBe(false);
  expect((await readTaskData(account))!.operations).toEqual([]);
});

it('does not send a closure older than 30 days or redate its actual time', async () => {
  const f = await fixture();
  await f.store.enqueue(listId, taskId, { type: 'update', data: { isDone: true } });
  const original = (await readTaskData(account))!.operations[0]!;
  vi.spyOn(Date, 'now').mockReturnValue(original.submittedAt + OFFLINE_REPLAY_MAX_AGE_MS + 1);
  onlineManager.setOnline(true);
  await f.store.synchronize();
  expect(f.store.getSnapshot().pending[0]).toMatchObject({ reason: 'expired', change: original.change });
  expect(f.receipts.size).toBe(0);
});

it('merges two tabs on one occurrence and respects revoked access before replay', async () => {
  const f = await fixture();
  const second = createTaskOfflineStore(f.request);
  await second.activate(account);
  await Promise.all([
    f.store.enqueue(listId, taskId, { type: 'update', data: { isDone: true } }),
    second.enqueue(listId, taskId, { type: 'update', data: { isDone: false } }),
  ]);
  expect((await readTaskData(account))!.operations).toHaveLength(2);
  f.revoke();
  onlineManager.setOnline(true);
  await f.store.synchronize();
  expect(f.receipts.size).toBe(0);
  expect(f.store.getSnapshot().items).toEqual({});
  expect((await readTaskData(account))!.operations).toEqual([]);
});

it('orders checklist and content edits before capturing the closure version', async () => {
  const f = await fixture();
  await f.store.enqueue(listId, taskId, { type: 'checklist-create', data: { id: crypto.randomUUID(), title: 'Okna' } });
  await f.store.enqueue(listId, taskId, { type: 'update', data: { notes: 'Raz' } });
  await f.store.enqueue(listId, taskId, { type: 'update', data: { isDone: true } });
  const ops = await transact('readonly', (tx) => readOperations(tx, account));
  expect(new Set(ops.flatMap((op) => op.orderingKeys)).size).toBe(1);
  expect(ops[2]!.dependsOn).toContain(ops[1]!.operationId);
  expect((await readTaskData(account))!.operations[2]!.change).toMatchObject({
    data: { expectedOccurrenceVersion: 2 },
  });
});

it('preserves legacy wire semantics through takeover and orders new completion after an old checklist write', async () => {
  const f = await fixture();
  const legacy = {
    id: crypto.randomUUID(),
    submittedAt: Date.now(),
    listId,
    taskId,
    status: 'pending' as const,
    change: { type: 'checklist-create' as const, data: { id: crypto.randomUUID(), title: 'Stary krok' } },
  };
  await updateTaskData(account, (data) => {
    data.operations.push(legacy);
  });
  await f.store.enqueue(listId, taskId, { type: 'update', data: { isDone: true } });
  const saved = (await readTaskData(account))!.operations;
  expect(saved[0]).toEqual(legacy);
  expect(saved[1]!.change).toMatchObject({ data: { expectedOccurrenceVersion: 1 } });
  const ops = await transact('readonly', (tx) => readOperations(tx, account));
  expect(ops[1]!.dependsOn).toContain(legacy.id);

  await updateTaskData(account, (data) => {
    data.operations = [{ ...legacy, change: { type: 'update', data: { isDone: true } } }];
  });
  const old = (await transact('readonly', (tx) => readOperations(tx, account)))[0]!;
  const transport = vi.fn(async (path: string) =>
    path === '/api/tasks/snapshot' ? { ok: true, lists: [list], items: { [listId]: [task] } } : { task },
  );
  await taskAdapter(account, transport as <T>(path: string) => Promise<T>).send(old, new AbortController().signal);
  const body = JSON.parse(String((transport.mock.calls as unknown as [string, RequestInit][])[0]![1].body));
  expect(body).toEqual({ isDone: true });
  expect((await readTaskData(account))!.operations[0]!.occurrence).toBeUndefined();
});

it('keeps offline skipping unavailable while ordinary content edits remain accepted', async () => {
  const f = await fixture();
  await expect(f.store.enqueue(listId, taskId, { type: 'remove' })).rejects.toThrow('wymaga internetu');
  await f.store.enqueue(listId, taskId, { type: 'update', data: { title: 'Nowa treść' } });
  expect(f.store.getSnapshot().items[listId]![0]!.title).toBe('Nowa treść');
});

it('rolls back the successor snapshot when outbox acknowledgement fails, then safely retries', async () => {
  const f = await fixture();
  await f.store.enqueue(listId, taskId, { type: 'update', data: { isDone: true } });
  const original = IDBObjectStore.prototype.delete;
  const failure = vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, key) {
    if (this.name === 'outbox') throw new Error('ACK storage failure');
    return original.call(this, key);
  });
  onlineManager.setOnline(true);
  await f.store.synchronize();
  expect(f.receipts.size).toBe(1);
  expect((await readTaskData(account))!.operations).toHaveLength(1);
  expect((await readTaskData(account))!.snapshot.items[listId]).toMatchObject([{ isDone: false }]);
  failure.mockRestore();
  await retry();
  await f.store.synchronize();
  expect(f.receipts.size).toBe(1);
  expect((await readTaskData(account))!.operations).toEqual([]);
  expect((await readTaskData(account))!.snapshot.items[listId]).toHaveLength(2);
});
