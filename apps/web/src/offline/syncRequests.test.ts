import './testSetup.js';
import { onlineManager } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import type { Task } from '@rodzina/shared';
import type { AccountSession } from '../session.js';
import { taskAdapter } from '../features/tasks/taskAdapter.js';
import { shoppingAdapter } from '../features/shopping/shoppingAdapter.js';
import { emptyShopping, putShoppingTransaction } from '../features/shopping/shoppingStorage.js';
import { mealAdapter } from '../features/meals/mealOffline.js';
import { shiftMealDate } from '../features/meals/mealDates.js';
import { activateOfflineAccount, transact } from './database.js';
import { appendOperation, readOperations } from './outbox.js';
import { startSync } from './sync.js';

const familyId = '10000000-0000-4000-8000-000000000001';
const userId = '10000000-0000-4000-8000-000000000002';
const listId = '10000000-0000-4000-8000-000000000003';
const account = `${familyId}:${userId}`;
const session = { user: { id: userId, familyId, role: 'admin' }, family: { id: familyId } } as AccountSession;
const task: Task = {
  id: '10000000-0000-4000-8000-000000000004',
  listId,
  title: 'Zadanie',
  notes: null,
  dueDate: null,
  dueTime: null,
  assigneeId: null,
  isDone: false,
  doneAt: null,
  doneBy: null,
  position: 0,
  createdBy: userId,
  createdAt: 1,
  updatedAt: 1,
};
const weekStart = '2026-11-02';
const week = {
  ok: true,
  weekStart,
  days: Array.from({ length: 7 }, (_, index) => ({ date: shiftMealDate(weekStart, index), meals: [] })),
};
const intents = {
  tasks: { listId, taskId: task.id, change: { type: 'update', data: { title: 'Zmienione zadanie' } } },
  shopping: { type: 'edit', listId, id: 'item', data: { isChecked: true } },
  meals: { type: 'write', weekStart, writes: [{ date: weekStart, id: task.id, expectedId: null, data: null }] },
};

it.each([
  { name: 'tasks', modules: ['tasks'], auth: 1, lists: 1 },
  { name: 'shopping', modules: ['shopping'], auth: 1, lists: 0 },
  { name: 'meals', modules: ['meals'], auth: 1, lists: 0 },
  { name: 'mixed', modules: ['tasks', 'shopping', 'meals'], auth: 1, lists: 1 },
] as const)(
  'replays 30 $name operations with $auth session and $lists list requests',
  async ({ modules, auth, lists }) => {
    const n = 30;
    const fetch = vi.fn(async (path: string, init?: RequestInit) => {
      const { pathname, searchParams } = new URL(path, 'https://test');
      let result: unknown;
      if (pathname === '/api/auth/me') result = session;
      else if (pathname === '/api/tasks/lists') result = { lists: [{ id: listId }] };
      else {
        expect(searchParams.get('operationId')).toBeTruthy();
        expect(searchParams.get('actorId')).toBe(userId);
        if (pathname === `/api/tasks/${task.id}` && init?.method === 'PATCH') result = { task };
        else if (pathname === '/api/shopping/items/item' && init?.method === 'PATCH') result = {};
        else if (pathname === '/api/meals/offline' && init?.method === 'POST') result = { week };
        else throw new Error(`Unexpected request: ${path}`);
      }
      return new Response(JSON.stringify(result));
    });
    vi.stubGlobal('fetch', fetch);
    onlineManager.setOnline(false);
    let sender: ReturnType<typeof startSync> | undefined;
    try {
      await activateOfflineAccount(account);
      await transact('readwrite', async (tx) => {
        await putShoppingTransaction(tx, emptyShopping(session), true);
        for (let index = 0; index < n; index++) {
          const module = modules[index % modules.length]!;
          await appendOperation(tx, account, module, {
            operationId: crypto.randomUUID(),
            submittedAt: Date.now(),
            entityId: module,
            orderingKeys: [module],
            payload: intents[module],
          });
        }
      });
      sender = startSync(
        account,
        [taskAdapter(account), shoppingAdapter({ familyId, userId }), mealAdapter(account)],
        () => {},
      );
      onlineManager.setOnline(true);
      await sender.synchronize();
      expect(await transact('readonly', (tx) => readOperations(tx, account))).toEqual([]);
      const paths = fetch.mock.calls.map(([path]) => path);
      expect(paths.filter((path) => path === '/api/auth/me')).toHaveLength(auth);
      expect(paths.filter((path) => path === '/api/tasks/lists')).toHaveLength(lists);
      expect(paths).toHaveLength(n + auth + lists);
    } finally {
      sender?.stop();
      onlineManager.setOnline(true);
      vi.unstubAllGlobals();
    }
  },
);
