import { beforeEach, expect, it, vi } from 'vitest';
import { OFFLINE_REPLAY_MAX_AGE_MS, type Task, type TaskList } from '@rodzina/shared';
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
function fixture() {
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
  store.activate(account);
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
beforeEach(() => {
  localStorage.clear();
});

function expireFirst() {
  const key = Object.keys(localStorage).find((key) => key.includes(':operation:'))!;
  const op = JSON.parse(localStorage.getItem(key)!);
  op.submittedAt = Date.now() - OFFLINE_REPLAY_MAX_AGE_MS - 1000;
  localStorage.setItem(key, JSON.stringify(op));
  return { key, op };
}

it('quarantines an expired create and its edit/delete chain, but sends an independent task and refreshes', async () => {
  const f = fixture();
  await f.store.synchronize();
  const id = crypto.randomUUID();
  f.store.enqueue(listId, id, { type: 'create', data: { title: 'Stare zadanie' } });
  const { key, op } = expireFirst();
  // Legacy journals may contain a full chain written before the replay limit elapsed.
  const dependent = ['update', 'remove'].map((type, index) => ({
    id: crypto.randomUUID(),
    submittedAt: Date.now() + index,
    listId,
    taskId: id,
    change: type === 'update' ? { type, data: { notes: 'Późniejsza notatka' } } : { type },
  }));
  for (const entry of dependent) localStorage.setItem(key.replace(op.id, entry.id), JSON.stringify(entry));
  f.store.enqueue(listId, crypto.randomUUID(), { type: 'create', data: { title: 'Świeże zadanie' } });
  f.request.mockClear();
  await f.store.synchronize();
  expect(f.request.mock.calls.filter(([, init]) => init?.method)).toHaveLength(1);
  expect(f.tasks().some((entry) => entry.title === 'Świeże zadanie')).toBe(true);
  expect(f.request.mock.calls.some(([path]) => path.endsWith('?status=all'))).toBe(true);
  expect(f.store.getSnapshot().pending.map((entry) => [entry.id, entry.status, entry.reason])).toEqual([
    [op.id, 'needs-review', 'expired'],
    ...dependent.map((entry) => [entry.id, 'needs-review', 'dependency']),
  ]);
  expect(f.store.project().items[listId]?.some((entry) => entry.id === id)).toBe(false);
  expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({
    id: op.id,
    submittedAt: op.submittedAt,
    change: op.change,
  });
  expect(() => f.store.enqueue(listId, id, { type: 'remove' })).toThrow('Najpierw sprawdź');
});

it('refreshes confirmed data even when replay fails transiently', async () => {
  const f = fixture();
  await f.store.synchronize();
  f.store.enqueue(listId, taskId, { type: 'update', data: { notes: 'Lokalna' } });
  f.setReject(new ApiRequestError('Później', 500));
  f.request.mockClear();
  await f.store.synchronize();
  expect(f.request.mock.calls.some(([path]) => path.endsWith('?status=all'))).toBe(true);
  expect(f.store.getSnapshot().items[listId]![0]!.notes).toBeNull();
  expect(f.store.getSnapshot().pending).toHaveLength(1);
});

it('discards only the inspected chain durably across tabs and requires a fresh read before a new write', async () => {
  const f = fixture();
  await f.store.synchronize();
  f.store.enqueue(listId, taskId, { type: 'update', data: { dueDate: '2027-01-01' } });
  expireFirst();
  await f.store.synchronize();
  const other = createTaskOfflineStore(f.request as <T>(path: string, init?: RequestInit) => Promise<T>);
  other.activate(account);
  expect(other.blockedTasks(account)).toEqual([taskId]);
  const ids = f.store.getSnapshot().pending.map((op) => op.id);
  const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Quota');
  });
  expect(() => f.store.discardReview(ids)).toThrow('Nie można zapisać');
  expect(f.store.getSnapshot().pending).toHaveLength(1);
  failure.mockRestore();
  // Cleanup can fail after the single atomic decision; the old journal must stay excluded.
  const cleanupFailure = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('Quota');
  });
  f.store.discardReview(ids);
  cleanupFailure.mockRestore();
  other.reload();
  expect(other.getSnapshot().pending).toEqual([]);
  expect(other.blockedTasks(account)).toEqual([]);
  const restored = createTaskOfflineStore(f.request as <T>(path: string, init?: RequestInit) => Promise<T>);
  restored.activate(account);
  expect(restored.getSnapshot().pending).toEqual([]);
  expect(() => restored.enqueue(listId, taskId, { type: 'remove' })).toThrow('odśwież listę');
  await restored.synchronize();
  restored.enqueue(listId, taskId, { type: 'update', data: { title: 'Świadoma nowa zmiana' } });
  expect(restored.getSnapshot().pending[0]!.id).not.toBe(ids[0]);
  restored.clear();
  expect(localStorage.length).toBe(0);
});

it('does not revive persisted review after clock correction and restores alarm suppression offline', async () => {
  const f = fixture();
  await f.store.synchronize();
  f.store.enqueue(listId, taskId, { type: 'remove' });
  expireFirst();
  await f.store.synchronize();
  const restored = createTaskOfflineStore();
  vi.spyOn(Date, 'now').mockReturnValue(1);
  try {
    restored.activate(account);
    expect(restored.blockedTasks(account)).toEqual([taskId]);
    expect(restored.blockedTasks('another:user')).toEqual([]);
    expect(restored.project().items[listId]).toEqual([task]);
    expect(restored.getSnapshot().pending[0]!.status).toBe('needs-review');
  } finally {
    vi.restoreAllMocks();
  }
});

it('persists review discovered on offline startup and protects unseen changes during discard', async () => {
  const f = fixture();
  await f.store.synchronize();
  f.store.enqueue(listId, taskId, { type: 'remove' });
  const { key, op } = expireFirst();
  const restored = createTaskOfflineStore();
  restored.activate(account);
  expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ status: 'needs-review', reason: 'expired' });
  const later = {
    ...op,
    id: crypto.randomUUID(),
    submittedAt: Date.now(),
    change: { type: 'update', data: { notes: 'Druga karta' } },
  };
  localStorage.setItem(key.replace(op.id, later.id), JSON.stringify(later));
  expect(() => restored.discardReview([op.id])).toThrow('Lista zmian uległa zmianie');
  restored.reload();
  expect(restored.getSnapshot().pending).toHaveLength(2);
  restored.clear(false);
  expect(restored.getSnapshot().pending).toEqual([]);
  const other = createTaskOfflineStore();
  other.activate(account);
  expect(other.getSnapshot().pending).toHaveLength(2);
});

it('continues independent work when persisting review status fails and never projects the expired edit', async () => {
  const f = fixture();
  await f.store.synchronize();
  f.store.enqueue(listId, taskId, { type: 'update', data: { isDone: true } });
  expireFirst();
  f.store.enqueue(listId, crypto.randomUUID(), { type: 'create', data: { title: 'Niezależne' } });
  const original = Storage.prototype.setItem;
  const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key.includes(':operation:') && value.includes('needs-review')) throw new Error('Quota');
    original.call(this, key, value);
  });
  try {
    await f.store.synchronize();
    expect(f.tasks().some((entry) => entry.title === 'Niezależne')).toBe(true);
    expect(f.store.getSnapshot().error).toContain('Nie można zapisać');
    expect(f.store.project().items[listId]![0]!.isDone).toBe(false);
  } finally {
    failure.mockRestore();
  }
});

it('keeps an expired operation on the device without replaying it after restart', async () => {
  const f = fixture();
  await f.store.synchronize();
  f.store.enqueue(listId, taskId, { type: 'update', data: { isDone: true } });
  const key = Object.keys(localStorage).find((key) => key.includes(':operation:'))!;
  const operation = JSON.parse(localStorage.getItem(key)!);
  operation.submittedAt = Date.now() - OFFLINE_REPLAY_MAX_AGE_MS - 1000;
  localStorage.setItem(key, JSON.stringify(operation));
  const restored = createTaskOfflineStore(f.request as <T>(path: string, init?: RequestInit) => Promise<T>);
  restored.activate(account);
  f.request.mockClear();
  await restored.synchronize();
  expect(f.request.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  expect(restored.getSnapshot().pending[0]).toMatchObject({ status: 'needs-review', reason: 'expired' });
  expect(restored.project().items[listId]![0]!.isDone).toBe(false);
  expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({ status: 'needs-review', reason: 'expired' });
  expect(restored.getSnapshot().pending).toHaveLength(1);
  expect(localStorage.getItem(key)).not.toBeNull();
});

it('prefetches lists and full tasks, and restores them without a request after process restart', async () => {
  const f = fixture();
  await f.store.synchronize();
  const request = vi.fn();
  const restored = createTaskOfflineStore(request);
  restored.activate(account);
  expect(restored.project().items[listId]).toEqual([task]);
  expect(request).not.toHaveBeenCalled();
});
it('durably adds, edits and checks a task before networking, then restores pending work', async () => {
  const f = fixture();
  await f.store.synchronize();
  const id = crypto.randomUUID();
  f.store.enqueue(listId, id, { type: 'create', data: { title: 'Paczka' } });
  f.store.enqueue(listId, id, { type: 'update', data: { notes: 'Jutro', isDone: true } });
  const restored = createTaskOfflineStore();
  restored.activate(account);
  expect(restored.getSnapshot().pending).toHaveLength(2);
  expect(restored.project().items[listId]).toContainEqual(
    expect.objectContaining({ id, title: 'Paczka', notes: 'Jutro', isDone: true }),
  );
  await f.store.synchronize();
  expect(f.store.getSnapshot().pending).toHaveLength(0);
  expect(f.tasks().filter((entry) => entry.id === id)).toHaveLength(1);
});
it('keeps an operation after a lost response and reuses its identity without duplicating the task', async () => {
  const f = fixture();
  await f.store.synchronize();
  f.store.enqueue(listId, crypto.randomUUID(), { type: 'create', data: { title: 'Paczka' } });
  f.lose();
  await f.store.synchronize();
  expect(f.store.getSnapshot().pending).toHaveLength(1);
  await f.store.synchronize();
  expect(f.store.getSnapshot().pending).toHaveLength(0);
  expect(f.tasks()).toHaveLength(2);
  const posts = f.request.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts[0]![0]).toBe(posts[1]![0]);
});
it.each([429, 500])('retains ordered work on transient HTTP %s', async (status) => {
  const f = fixture();
  await f.store.synchronize();
  f.store.enqueue(listId, taskId, { type: 'update', data: { title: 'Nowy' } });
  f.store.enqueue(listId, taskId, { type: 'update', data: { notes: 'Notatka' } });
  f.setReject(new ApiRequestError('Później', status));
  await f.store.synchronize();
  expect(f.store.getSnapshot().pending).toHaveLength(2);
  expect(f.store.project().items[listId]![0]).toMatchObject({ title: 'Nowy', notes: 'Notatka' });
});
it('removes revoked private data and its queued writes before sending any mutation', async () => {
  const f = fixture();
  await f.store.synchronize();
  f.store.enqueue(listId, taskId, { type: 'update', data: { isDone: true } });
  f.revoke();
  await f.store.synchronize();
  expect(f.store.project().items).toEqual({});
  expect(f.store.getSnapshot().pending).toHaveLength(0);
  expect(f.request.mock.calls.some(([, init]) => !!init?.method)).toBe(false);
  expect(localStorage.getItem(TASK_STORAGE_KEY)).not.toContain('Farba');
});

it('purges review data when access is lost during refresh', async () => {
  const f = fixture();
  await f.store.synchronize();
  f.store.enqueue(listId, taskId, { type: 'remove' });
  expireFirst();
  const original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (path, init) => {
    if (path.endsWith('?status=all')) throw new ApiRequestError('Brak dostępu', 403);
    return original(path, init);
  });
  await f.store.synchronize();
  expect(f.store.project().items).toEqual({});
  expect(f.store.getSnapshot().pending).toEqual([]);
  const restored = createTaskOfflineStore();
  restored.activate(account);
  expect(restored.getSnapshot().pending).toEqual([]);
  expect(restored.project().items).toEqual({});
});

it('does not restore review data after logout while a confirmed-data request is in flight', async () => {
  const f = fixture();
  await f.store.synchronize();
  f.store.enqueue(listId, taskId, { type: 'remove' });
  expireFirst();
  let finish!: (data: unknown) => void;
  const original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (path, init) => {
    if (path.endsWith('?status=all'))
      return new Promise((resolve) => {
        finish = resolve;
      });
    return original(path, init);
  });
  const synchronization = f.store.synchronize();
  await vi.waitFor(() => expect(finish).toBeDefined());
  f.store.clear();
  f.store.activate('another:account');
  finish({ tasks: [task] });
  await synchronization;
  expect(f.store.getSnapshot()).toMatchObject({ account: 'another:account', items: {}, pending: [] });
  expect(localStorage.length).toBe(0);
});
it('rejects failed writes independently without rolling back a subsequent valid edit', async () => {
  const f = fixture();
  await f.store.synchronize();
  f.store.enqueue(listId, taskId, { type: 'update', data: { assigneeId: crypto.randomUUID() } });
  f.store.enqueue(listId, taskId, { type: 'update', data: { notes: 'Zachowaj' } });
  f.setReject(new ApiRequestError('Osoba opuściła listę', 400));
  const original = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (path, init) => {
    if (init?.body && String(init.body).includes('Zachowaj')) f.setReject();
    return original(path, init);
  });
  await f.store.synchronize();
  expect(f.store.getSnapshot().pending).toHaveLength(0);
  expect(f.store.project().items[listId]![0]!.notes).toBe('Zachowaj');
  expect(f.store.getSnapshot().error).toContain('Osoba opuściła listę');
});
it('does not recreate a task deleted on the server', async () => {
  const f = fixture();
  await f.store.synchronize();
  f.store.enqueue(listId, taskId, { type: 'update', data: { title: 'Nowy' } });
  f.setReject(new ApiRequestError('Zadanie nie istnieje.', 404));
  await f.store.synchronize();
  expect(f.store.getSnapshot().pending).toHaveLength(0);
  expect(f.request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
});
it('does not acknowledge an edit when durable storage fails', async () => {
  const f = fixture();
  await f.store.synchronize();
  const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Quota');
  });
  expect(() => f.store.enqueue(listId, taskId, { type: 'update', data: { isDone: true } })).toThrow(
    'nie została przyjęta',
  );
  expect(f.store.project().items[listId]![0]!.isDone).toBe(false);
  expect(f.store.getSnapshot().pending).toHaveLength(0);
  failure.mockRestore();
});
it('ignores a response from a previous account and clears pending data on logout', async () => {
  const f = fixture();
  await f.store.synchronize();
  f.store.enqueue(listId, taskId, { type: 'remove' });
  let finish!: (result: unknown) => void;
  f.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.store.synchronize();
  f.store.clear();
  finish({ user: { id: user }, family: { id: family } });
  await pending;
  expect(f.store.getSnapshot().account).toBe('');
  expect(localStorage.length).toBe(0);
});
it('isolates restored data by account and blocks assignment and reminder changes offline', async () => {
  const f = fixture();
  await f.store.synchronize();
  f.store.activate(`${family}:${crypto.randomUUID()}`);
  expect(f.store.project().lists).toBeUndefined();
  expect(offlineTaskPatch({ title: 'Nowy', assigneeId: null }, task)).toEqual({ title: 'Nowy' });
  expect(() => offlineTaskPatch({ assigneeId: user }, task)).toThrow('przypisanej osoby');
  expect(() => offlineTaskPatch({ reminders: [] }, task)).toThrow('przypomnień');
});
it('retains independent journal entries from multiple tabs', async () => {
  const f = fixture();
  await f.store.synchronize();
  const other = createTaskOfflineStore();
  other.activate(account);
  f.store.enqueue(listId, taskId, { type: 'update', data: { title: 'Tytuł' } });
  other.enqueue(listId, taskId, { type: 'update', data: { notes: 'Notatka' } });
  f.store.reload();
  expect(f.store.getSnapshot().pending).toHaveLength(2);
  expect(f.store.project().items[listId]![0]).toMatchObject({ title: 'Tytuł', notes: 'Notatka' });
});

it('reports a corrupt cache without exposing its content and recovers online', async () => {
  localStorage.setItem(TASK_STORAGE_KEY, '{bad json');
  const f = fixture();
  expect(f.store.project().lists).toBeUndefined();
  expect(f.store.getSnapshot().error).toContain('Nie można odczytać');
  await f.store.synchronize();
  expect(f.store.getSnapshot().error).toBeUndefined();
  expect(f.store.project().items[listId]).toEqual([task]);
});

it('purges revoked content from memory even when persisting the purge fails', async () => {
  const f = fixture();
  await f.store.synchronize();
  f.revoke();
  const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Quota');
  });
  await f.store.synchronize();
  expect(f.store.project().items).toEqual({});
  expect(f.store.project().lists).toEqual([]);
  expect(f.store.getSnapshot().error).toContain('Nie można zapisać');
  failure.mockRestore();
});
