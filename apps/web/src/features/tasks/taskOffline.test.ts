import '../../offline/testSetup.js';
import { IDBObjectStore } from 'fake-indexeddb';
import { readTaskData, updateTaskData } from './taskStorage.js';
import { transact, clearDatabase, closeDatabase } from '../../offline/database.js';
import { expect, it, vi } from 'vitest';
import { OFFLINE_REPLAY_MAX_AGE_MS, type Task, type TaskList } from '@rodzina/shared';
import { readOperations } from '../../offline/outbox.js';
import { ApiRequestError } from '../../api.js';
import { createTaskOfflineStore, offlineTaskPatch, TASK_STORAGE_KEY } from './taskOffline.js';

const family = '10000000-0000-4000-8000-000000000001';
const user = '10000000-0000-4000-8000-000000000002';
const listId = '10000000-0000-4000-8000-000000000003';
const taskId = '10000000-0000-4000-8000-000000000004';
const account = `${family}:${user}`;
const list: TaskList = {
  id: listId,
  familyId: family,
  ownerId: user,
  memberIds: [],
  name: 'Moje zadania',
  isDefault: true,
  position: 0,
  openTaskCount: 1,
  createdAt: 1,
  updatedAt: 1,
};
const task: Task = {
  id: taskId,
  listId,
  title: 'Farba',
  notes: null,
  dueDate: '2026-10-20',
  dueTime: null,
  assigneeId: null,
  isDone: false,
  doneAt: null,
  doneBy: null,
  position: 0,
  createdBy: user,
  createdAt: 1,
  updatedAt: 1,
};
async function fixture() {
  let lists = [list];
  let tasks = [task];
  let reject: Error | undefined;
  let loseResponse = false;
  const responses = new Map<string, object>();
  const request = vi.fn(async (path: string, init?: RequestInit): Promise<unknown> => {
    if (path === '/api/auth/me') return { family: { id: family }, user: { id: user } };
    if (path === '/api/tasks/lists') return { lists };
    if (!init?.method) return { tasks };
    if (reject) throw reject;
    if (responses.has(path)) return responses.get(path);
    const data = init.body ? JSON.parse(String(init.body)) : {};
    if (init.method === 'POST')
      tasks = [...tasks, { ...task, ...data, id: new URL(path, 'https://test').searchParams.get('taskId')! }];
    if (init.method === 'PATCH') tasks = tasks.map((entry) => ({ ...entry, ...data }));
    if (init.method === 'DELETE') tasks = [];
    const result = init.method === 'DELETE' ? {} : { task: tasks.at(-1) };
    responses.set(path, result);
    if (loseResponse) {
      loseResponse = false;
      throw new TypeError('Network lost');
    }
    return result;
  });
  const store = createTaskOfflineStore(request as <T>(path: string, init?: RequestInit) => Promise<T>);
  await store.activate(account);
  return {
    store,
    request,
    setReject: (error?: Error) => {
      reject = error;
    },
    revoke: () => {
      lists = [];
    },
    lose: () => {
      loseResponse = true;
    },
    tasks: () => tasks,
  };
}

async function expireFirst() {
  await updateTaskData(account, (data) => {
    data.operations[0]!.submittedAt = Date.now() - OFFLINE_REPLAY_MAX_AGE_MS - 1000;
  });
}

it('restores downloaded data and pending create/edit projection after an offline restart', async () => {
  const f = await fixture();
  await f.store.synchronize();
  const id = crypto.randomUUID();
  await f.store.enqueue(listId, id, { type: 'create', data: { title: 'Paczka' } });
  await f.store.enqueue(listId, id, { type: 'update', data: { notes: 'Jutro', isDone: true } });
  const original = await readTaskData(account);
  expect(original?.snapshot.items[listId]?.some((task) => task.id === id)).toBe(false);
  await closeDatabase();
  const restored = createTaskOfflineStore(f.request as <T>(path: string, init?: RequestInit) => Promise<T>);
  await restored.activate(account);
  expect(restored.getSnapshot().pending).toEqual(original?.operations);
  expect(restored.project().items[listId]).toContainEqual(
    expect.objectContaining({ id, title: 'Paczka', notes: 'Jutro', isDone: true }),
  );
  await restored.synchronize();
  expect(restored.getSnapshot().pending).toEqual([]);
  expect(f.tasks().filter((task) => task.id === id)).toHaveLength(1);
  expect(localStorage.getItem(TASK_STORAGE_KEY)).toBeNull();
});

it('persists review and dependent status, keeps alarm suppression after restart and clock correction', async () => {
  const f = await fixture();
  await f.store.synchronize();
  await f.store.enqueue(listId, taskId, { type: 'update', data: { dueDate: '2027-01-01' } });
  await f.store.enqueue(listId, taskId, { type: 'remove' });
  await expireFirst();
  await f.store.reload();
  const original = f.store.getSnapshot().pending;
  expect(original.map((op) => op.reason)).toEqual(['expired', 'dependency']);
  expect(f.store.blockedTasks(account)).toEqual([taskId, taskId]);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1);
  try {
    const restored = createTaskOfflineStore();
    await restored.activate(account);
    expect(restored.getSnapshot().pending).toEqual(original);
    expect(restored.project().items[listId]).toEqual([task]);
    await expect(restored.enqueue(listId, taskId, { type: 'remove' })).rejects.toThrow('Najpierw sprawdź');
    expect(restored.blockedTasks('other:user')).toEqual([]);
  } finally {
    clock.mockRestore();
  }
});

it('does not replay old operations but continues independent work and refreshes confirmed data', async () => {
  const f = await fixture();
  await f.store.synchronize();
  await f.store.enqueue(listId, taskId, { type: 'remove' });
  await expireFirst();
  await f.store.enqueue(listId, crypto.randomUUID(), { type: 'create', data: { title: 'Nowe' } });
  f.request.mockClear();
  await f.store.synchronize();
  expect(f.request.mock.calls.filter(([, init]) => init?.method)).toHaveLength(1);
  expect(f.store.getSnapshot().pending).toHaveLength(1);
  expect(f.store.getSnapshot().pending[0]?.reason).toBe('expired');
  expect(f.tasks().some((task) => task.title === 'Nowe')).toBe(true);
});

it('discards only the inspected review chain atomically and requires a fresh server read', async () => {
  const f = await fixture();
  await f.store.synchronize();
  await f.store.enqueue(listId, taskId, { type: 'remove' });
  await expireFirst();
  await f.store.reload();
  const ids = f.store.getSnapshot().pending.map((op) => op.id);
  const fail = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
    throw new DOMException('Quota', 'QuotaExceededError');
  });
  await expect(f.store.discardReview(ids)).rejects.toThrow();
  fail.mockRestore();
  expect((await readTaskData(account))?.operations).toHaveLength(1);
  await f.store.discardReview(ids);
  const restored = createTaskOfflineStore(f.request as <T>(path: string, init?: RequestInit) => Promise<T>);
  await restored.activate(account);
  expect(restored.getSnapshot().pending).toEqual([]);
  await expect(restored.enqueue(listId, taskId, { type: 'remove' })).rejects.toThrow('odśwież listę');
  await restored.synchronize();
  await restored.enqueue(listId, taskId, { type: 'update', data: { title: 'Nowa decyzja' } });
  expect(restored.getSnapshot().pending[0]?.id).not.toBe(ids[0]);
});

it('retains unseen changes from another tab when rejecting a stale discard decision', async () => {
  const f = await fixture();
  await f.store.synchronize();
  await f.store.enqueue(listId, taskId, { type: 'remove' });
  await expireFirst();
  await f.store.reload();
  const ids = f.store.getSnapshot().pending.map((op) => op.id);
  await updateTaskData(account, (data) => {
    data.operations.push({ ...data.operations[0]!, id: crypto.randomUUID(), submittedAt: Date.now() });
  });
  await expect(f.store.discardReview(ids)).rejects.toThrow('Lista zmian');
  expect((await readTaskData(account))?.operations).toHaveLength(2);
});

it('reuses the same operation ID after a lost response without duplicating a created task', async () => {
  const f = await fixture();
  await f.store.synchronize();
  await f.store.enqueue(listId, crypto.randomUUID(), { type: 'create', data: { title: 'Paczka' } });
  f.lose();
  await f.store.synchronize();
  expect(f.store.getSnapshot().pending).toHaveLength(1);
  const waiting = await transact('readonly', (tx) => readOperations(tx, account));
  expect(waiting[0]?.status).toBe('retry-wait');
  await transact('readwrite', async (tx) => {
    tx.objectStore('outbox').put({ ...waiting[0], nextAttemptAt: 0 });
  });
  await f.store.synchronize();
  expect(f.store.getSnapshot().pending).toEqual([]);
  expect(f.tasks()).toHaveLength(2);
  const posts = f.request.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts[0]?.[0]).toBe(posts[1]?.[0]);
});

it.each([429, 500])('retains ordered work on HTTP %s', async (status) => {
  const f = await fixture();
  await f.store.synchronize();
  await f.store.enqueue(listId, taskId, { type: 'update', data: { title: 'Nowy' } });
  await f.store.enqueue(listId, taskId, { type: 'update', data: { notes: 'Notatka' } });
  f.setReject(new ApiRequestError('Później', status));
  await f.store.synchronize();
  expect(f.store.getSnapshot().pending).toHaveLength(2);
  expect(f.store.project().items[listId]?.[0]).toMatchObject({ title: 'Nowy', notes: 'Notatka' });
});

it('purges revoked private content and work before sending mutations, including after restart', async () => {
  const f = await fixture();
  await f.store.synchronize();
  await f.store.enqueue(listId, taskId, { type: 'update', data: { isDone: true } });
  f.revoke();
  f.request.mockClear();
  await f.store.synchronize();
  expect(f.request.mock.calls.some(([, init]) => !!init?.method)).toBe(false);
  expect(f.store.project().items).toEqual({});
  const restored = createTaskOfflineStore();
  await restored.activate(account);
  expect(restored.getSnapshot().pending).toEqual([]);
  expect(restored.project().items).toEqual({});
});

it('purges review work when access is revoked during list refresh', async () => {
  const f = await fixture();
  await f.store.synchronize();
  await f.store.enqueue(listId, taskId, { type: 'remove' });
  await expireFirst();
  const original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (path, init) => {
    if (path.endsWith('?status=all')) throw new ApiRequestError('Brak dostępu', 403);
    return original(path, init);
  });
  await f.store.synchronize();
  const restored = createTaskOfflineStore();
  await restored.activate(account);
  expect(restored.getSnapshot().pending).toEqual([]);
  expect(restored.project().items).toEqual({});
});

it('keeps revoked content out of memory when the purge cannot be persisted', async () => {
  const f = await fixture();
  await f.store.synchronize();
  f.revoke();
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
    throw new Error('Nie można zapisać');
  });
  try {
    await f.store.synchronize();
    expect(f.store.project().items).toEqual({});
    expect(f.store.project().lists).toEqual([]);
    expect(f.store.getSnapshot().error).toContain('Nie można zapisać');
  } finally {
    failure.mockRestore();
  }
});

it('retains a rejected object chain for review without recreating it and sends independent work', async () => {
  const f = await fixture();
  await f.store.synchronize();
  await f.store.enqueue(listId, taskId, { type: 'update', data: { assigneeId: crypto.randomUUID() } });
  await f.store.enqueue(listId, taskId, { type: 'update', data: { notes: 'Zachowaj' } });
  const independent = crypto.randomUUID();
  await f.store.enqueue(listId, independent, { type: 'create', data: { title: 'Niezależne' } });
  f.setReject(new ApiRequestError('Nie istnieje', 404));
  const original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (path, init) => {
    if (String(init?.body).includes('Niezależne')) f.setReject();
    return original(path, init);
  });
  await f.store.synchronize();
  expect(f.store.getSnapshot().pending.map((op) => op.reason)).toEqual(['rejected', 'dependency']);
  expect(f.store.project().items[listId]?.some((task) => task.id === independent)).toBe(true);
  expect(f.request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});

it('never acknowledges a failed durable edit and leaves its confirmed base intact', async () => {
  const f = await fixture();
  await f.store.synchronize();
  const before = await readTaskData(account);
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
    throw new DOMException('Quota', 'QuotaExceededError');
  });
  try {
    await expect(f.store.enqueue(listId, taskId, { type: 'update', data: { isDone: true } })).rejects.toThrow();
  } finally {
    failure.mockRestore();
  }
  expect(await readTaskData(account)).toEqual(before);
  expect(f.store.project().items[listId]?.[0]?.isDone).toBe(false);
});

it('merges concurrent tab writes in transactions without losing either operation', async () => {
  const f = await fixture();
  await f.store.synchronize();
  const other = createTaskOfflineStore();
  await other.activate(account);
  await Promise.all([
    f.store.enqueue(listId, taskId, { type: 'update', data: { title: 'Tytuł' } }),
    other.enqueue(listId, taskId, { type: 'update', data: { notes: 'Notatka' } }),
  ]);
  await f.store.reload();
  expect(f.store.getSnapshot().pending).toHaveLength(2);
  expect(f.store.project().items[listId]?.[0]).toMatchObject({ title: 'Tytuł', notes: 'Notatka' });
});

it.each(['auth', 'refresh', 'mutation'] as const)(
  'ignores a late %s response after logout and account change',
  async (phase) => {
    const f = await fixture();
    await f.store.synchronize();
    await f.store.enqueue(listId, taskId, { type: 'remove' });
    let finish!: (value: unknown) => void;
    const original = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (path, init) => {
      if (
        (phase === 'auth' && path === '/api/auth/me') ||
        (phase === 'refresh' && path.endsWith('?status=all')) ||
        (phase === 'mutation' && !!init?.method)
      )
        return new Promise((resolve) => {
          finish = resolve;
        });
      return original(path, init);
    });
    const pending = f.store.synchronize();
    await vi.waitFor(() => expect(finish).toBeDefined());
    f.store.clear(false);
    await clearDatabase();
    await f.store.activate('another:account');
    finish(
      phase === 'auth' ? { user: { id: user }, family: { id: family } } : phase === 'refresh' ? { tasks: [task] } : {},
    );
    await pending;
    expect(f.store.getSnapshot()).toMatchObject({ account: 'another:account', items: {}, pending: [] });
    expect(await readTaskData('another:account')).not.toHaveProperty('snapshot.lists');
  },
);

it('blocks assignment and reminder changes offline', () => {
  expect(offlineTaskPatch({ title: 'Nowy', assigneeId: null }, task)).toEqual({ title: 'Nowy' });
  expect(() => offlineTaskPatch({ assigneeId: user }, task)).toThrow('przypisanej osoby');
  expect(() => offlineTaskPatch({ reminders: [] }, task)).toThrow('przypomnień');
});

it('retains conflict dependencies and alarm blocks after restart while independent tasks synchronize', async () => {
  const f = await fixture();
  await f.store.synchronize();
  await f.store.enqueue(listId, taskId, { type: 'update', data: { dueDate: '2027-02-01' } });
  await f.store.enqueue(listId, taskId, { type: 'remove' });
  const id = crypto.randomUUID();
  await f.store.enqueue(listId, id, { type: 'create', data: { title: 'Niezależne' } });
  const original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (path, init) => {
    if (init?.method === 'PATCH') throw new ApiRequestError('Konflikt', 409, 'OPERATION_CONFLICT');
    return original(path, init);
  });
  await f.store.synchronize();
  expect(f.store.getSnapshot().pending.map((op) => op.reason)).toEqual(['conflict', 'dependency']);
  expect(f.store.blockedTasks(account)).toEqual([taskId, taskId]);
  expect(f.tasks().some((entry) => entry.id === id)).toBe(true);
  await closeDatabase();
  const restored = createTaskOfflineStore();
  await restored.activate(account);
  expect(restored.getSnapshot().pending.map((op) => op.reason)).toEqual(['conflict', 'dependency']);
  expect(restored.blockedTasks(account)).toEqual([taskId, taskId]);
  expect(restored.project().items[listId]?.find((entry) => entry.id === taskId)?.dueDate).toBe(task.dueDate);
});

it('removes private payloads and dependent work when access changes during a mutation', async () => {
  const f = await fixture();
  await f.store.synchronize();
  await f.store.enqueue(listId, taskId, { type: 'update', data: { notes: 'Prywatna treść' } });
  await f.store.enqueue(listId, taskId, { type: 'remove' });
  const original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (path, init) => {
    if (init?.method) {
      f.revoke();
      throw new ApiRequestError('Nie istnieje', 404);
    }
    return original(path, init);
  });
  await f.store.synchronize();
  expect(f.store.project().items).toEqual({});
  expect(f.store.getSnapshot().pending).toEqual([]);
  expect(JSON.stringify(await readTaskData(account))).not.toContain('Prywatna treść');
  expect(await transact('readonly', (tx) => readOperations(tx, account))).toEqual([]);
  expect((await readTaskData(account))?.rejection).toContain('Utracono dostęp');
  expect(f.request.mock.calls.filter(([, init]) => init?.method)).toHaveLength(1);
});
