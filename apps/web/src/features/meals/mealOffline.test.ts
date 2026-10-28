import '../../offline/testSetup.js';
import { QueryClient, onlineManager, dehydrate } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IDBObjectStore } from 'fake-indexeddb';
import { OFFLINE_REPLAY_MAX_AGE_MS, type Meal, type ShoppingItem } from '@rodzina/shared';
import { activateOfflineAccount, clearDatabase, closeDatabase, transact } from '../../offline/database.js';
import { appendOperation, readOperations } from '../../offline/outbox.js';
import { startSync, type SyncAdapter } from '../../offline/sync.js';
import { emptyShopping, putShoppingTransaction, readShoppingTransaction } from '../shopping/shoppingStorage.js';
import { applyShoppingChange, shoppingKey } from '../shopping/shoppingOptimistic.js';
import type { ShoppingSession } from '../shopping/shoppingOffline.js';
import {
  mealAdapter,
  restoreMeals,
  stopMeals,
  queueMeal,
  queueMealCopy,
  queueMealExport,
  saveMealWeek,
  mealRevision,
  visibleMeals,
  localMealSuggestions,
  confirmMealExport,
} from './mealOffline.js';
import { discardMealOperation } from './mealOffline.js';
import { readMeals } from './mealStorage.js';
import { shiftMealDate } from './mealDates.js';
import { ApiRequestError } from '../../api.js';

const familyId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const listId = '33333333-3333-4333-8333-333333333333';
const account = `${familyId}:${userId}`;
const session = { user: { id: userId, familyId, role: 'admin' }, family: { id: familyId } } as ShoppingSession;
const week = '2026-10-26';
const key = shoppingKey({ familyId, userId });
let client: QueryClient;
const senders: ReturnType<typeof startSync>[] = [];
const operations = () => transact('readonly', (tx) => readOperations(tx, account));
const read = () => transact('readonly', (tx) => readMeals(tx, account));
const input = { title: 'Pomidorowa', notes: null, ingredients: [{ name: 'Pomidory', quantity: '1 kg' }] };
const baseWeek = (start = week, meals: Meal[] = []) => ({
  ok: true,
  weekStart: start,
  days: Array.from({ length: 7 }, (_, index) => ({
    date: shiftMealDate(start, index),
    meals: meals.filter((meal) => meal.date === shiftMealDate(start, index)),
  })),
});
async function seedWeek(start = week, meals: Meal[] = []) {
  await saveMealWeek(baseWeek(start, meals), mealRevision(start));
}
async function seedShopping(items: ShoppingItem[] = [], includeList = true) {
  client.setQueryData(
    [...key, 'lists'],
    includeList
      ? [{ id: listId, familyId, name: 'Obiadowe', position: 0, createdBy: userId, createdAt: 1, updatedAt: 1 }]
      : [],
  );
  if (includeList) client.setQueryData([...key, 'items', listId], items);
  await transact('readwrite', async (tx) => {
    await putShoppingTransaction(tx, { ...emptyShopping(session), queries: dehydrate(client).queries }, true);
  });
}
beforeEach(async () => {
  onlineManager.setOnline(false);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await activateOfflineAccount(account);
  await restoreMeals(client, session);
  await seedWeek();
  await seedShopping();
});
afterEach(() => {
  stopMeals();
  for (const sender of senders.splice(0)) sender.stop();
  client.clear();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

it('persists edits, deletions, frozen copies, suggestions and an unknown week across a restart', async () => {
  await queueMeal(week, input);
  const id = visibleMeals().weeks[week]!.data.days[0]!.meals[0]!.id;
  await queueMeal(week, { ...input, title: 'Zmieniona pomidorowa' });
  await seedWeek('2026-11-02');
  await queueMealCopy('2026-11-02', false);
  await queueMeal(week, null);
  expect(visibleMeals().weeks[week]!.data.days[0]!.meals).toEqual([]);
  expect(visibleMeals().weeks['2026-11-02']!.data.days[0]!.meals[0]!.title).toBe('Zmieniona pomidorowa');
  expect(localMealSuggestions(visibleMeals(), ' POMIDOROWA ')).toHaveLength(1);
  await expect(queueMeal('2026-11-09', input)).rejects.toThrow('nie został pobrany');
  stopMeals();
  await closeDatabase();
  await activateOfflineAccount(account);
  await restoreMeals(client, session);
  expect(visibleMeals().weeks['2026-11-02']!.data.days[0]!.meals[0]!.title).toBe('Zmieniona pomidorowa');
  const queued = await operations();
  expect(queued).toHaveLength(4);
  expect((queued[0]!.payload as { writes: { id: string }[] }).writes[0]!.id).toBe(id);
  expect(queued[1]!.dependsOn).toContain(queued[0]!.operationId);
});

it('freezes export ingredients, projects purchases once and requires a separate repeat confirmation', async () => {
  await queueMeal(week, input);
  const meal = visibleMeals().weeks[week]!.data.days[0]!.meals[0]!;
  await queueMealExport(week, listId, [meal.id], false);
  await queueMeal(week, { ...input, ingredients: [{ name: 'Ryż', quantity: '10 kg' }] });
  const shopping = (await transact('readonly', (tx) => readShoppingTransaction(tx, account)))!;
  const exportOperation = shopping.operations.find((op) => op.change.type === 'mealExport')!;
  expect(exportOperation.change).toMatchObject({ ingredients: [{ name: 'Pomidory', quantity: '1 kg' }] });
  for (const op of shopping.operations) applyShoppingChange(client, { familyId, userId }, op.change, op.submittedAt);
  expect(client.getQueryData<ShoppingItem[]>([...key, 'items', listId])!.map((item) => item.name)).toEqual([
    'Pomidory',
  ]);
  expect((await operations()).filter((op) => op.module === 'shopping')).toHaveLength(0);
  await expect(queueMealExport(week, listId, [meal.id], false)).rejects.toMatchObject({
    code: 'MEAL_EXPORT_CONFIRMATION_REQUIRED',
  });
  await queueMealExport(week, listId, [meal.id], true);
  expect((await operations()).filter((op) => op.module === 'meals')).toHaveLength(4);
});

it('depends on a local list and atomically reconciles export identities without losing a later checkbox', async () => {
  await seedShopping([], false);
  await transact('readwrite', (tx) =>
    appendOperation(tx, account, 'shopping', {
      operationId: crypto.randomUUID(),
      submittedAt: Date.now(),
      entityId: listId,
      orderingKeys: [`shopping:list:${listId}`],
      payload: { type: 'createList', id: listId, name: 'Lokalna lista' },
    }),
  );
  await queueMeal(week, input);
  const meal = visibleMeals().weeks[week]!.data.days[0]!.meals[0]!;
  const exported = await queueMealExport(week, listId, [meal.id], false);
  const queued = await operations();
  const exportOperation = queued.find((op) => op.operationId === exported.operationId)!;
  expect(exportOperation.dependsOn).toHaveLength(2);
  const localId = exported.type === 'export' ? exported.data.targets![0]!.id : '';
  const actualId = crypto.randomUUID();
  await transact('readwrite', (tx) =>
    appendOperation(tx, account, 'shopping', {
      operationId: crypto.randomUUID(),
      submittedAt: Date.now(),
      entityId: localId,
      orderingKeys: [`shopping:list:${listId}`],
      payload: { type: 'edit', listId, id: localId, data: { isChecked: true } },
      dependsOn: [exportOperation.operationId],
    }),
  );
  // The confirmed list base exists by the time its dependent export is sent.
  await seedShopping();
  stopMeals();
  const actual = {
    id: actualId,
    listId,
    name: 'Pomidory',
    quantity: '1 kg',
    category: 'fruit_vegetables',
    position: 0,
    isChecked: false,
    checkedBy: null,
    checkedAt: null,
    createdBy: userId,
    createdAt: 1,
    updatedAt: 1,
  };
  const seen: unknown[] = [];
  const meals = mealAdapter(account);
  const adapter: SyncAdapter = {
    ...meals,
    prepare: async () => {},
    send: async (op) => {
      if (op.operationId === exported.operationId)
        return { ok: true, added: 0, updated: 1, items: [actual], aliases: { [localId]: actualId } };
      return { week: baseWeek(week) };
    },
  };
  const shoppingAdapter: SyncAdapter = {
    module: 'shopping',
    prepare: async () => {},
    send: async (op) => {
      seen.push(op.payload);
      return {};
    },
    reconcile: async () => {},
    invalidateAccess: async () => {},
  };
  onlineManager.setOnline(true);
  const sender = startSync(account, [adapter, shoppingAdapter], () => {});
  senders.push(sender);
  await sender.synchronize();
  expect(await operations()).toEqual([]);
  expect(seen).toContainEqual({ type: 'edit', listId, id: actualId, data: { isChecked: true } });
  expect((await read()).cache.results[exported.operationId]).toEqual({ added: 0, updated: 1 });
});

it('does not confirm local success or append an operation when durable storage fails', async () => {
  const before = visibleMeals();
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
    throw new DOMException('full', 'QuotaExceededError');
  });
  await expect(queueMeal(week, input)).rejects.toThrow();
  expect(visibleMeals()).toEqual(before);
  expect(await operations()).toHaveLength(0);
});

it('keeps replay IDs and payloads after a lost response and serializes competing tab senders', async () => {
  await queueMeal(week, input);
  const queued = (await operations())[0]!;
  stopMeals();
  const calls: unknown[] = [];
  let delivered = false;
  let active = 0;
  let maxActive = 0;
  const adapter: SyncAdapter = {
    ...mealAdapter(account),
    prepare: async () => {},
    send: async (op) => {
      calls.push([op.operationId, op.payload]);
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active--;
      if (!delivered) {
        delivered = true;
        throw new TypeError('lost response');
      }
      return { week: baseWeek() };
    },
  };
  vi.spyOn(Math, 'random').mockReturnValue(1);
  onlineManager.setOnline(true);
  const first = startSync(account, [adapter], () => {});
  senders.push(first);
  const second = startSync(account, [adapter], () => {});
  senders.push(second);
  await Promise.all([first.synchronize(), second.synchronize()]);
  await transact('readwrite', async (tx) => {
    const op = (await readOperations(tx, account))[0]!;
    tx.objectStore('outbox').put({ ...op, nextAttemptAt: 0 });
  });
  await Promise.all([first.synchronize(), second.synchronize()]);
  expect(calls).toEqual([
    [queued.operationId, queued.payload],
    [queued.operationId, queued.payload],
  ]);
  expect(maxActive).toBe(1);
  expect(await operations()).toEqual([]);
});

it('retains expired changes for review, refuses child writes and clears account data', async () => {
  await queueMeal(week, input);
  await transact('readwrite', async (tx) => {
    const op = (await readOperations(tx, account))[0]!;
    tx.objectStore('outbox').put({ ...op, submittedAt: Date.now() - OFFLINE_REPLAY_MAX_AGE_MS - 1 });
  });
  stopMeals();
  const send = vi.fn();
  onlineManager.setOnline(true);
  const sender = startSync(account, [{ ...mealAdapter(account), prepare: async () => {}, send }], () => {});
  senders.push(sender);
  await sender.synchronize();
  expect(send).not.toHaveBeenCalled();
  expect((await operations())[0]).toMatchObject({ status: 'needs-review', reviewReason: 'expired' });
  sender.stop();
  onlineManager.setOnline(false);
  await restoreMeals(client, { ...session, user: { ...session.user, role: 'child' } });
  await expect(queueMeal(week, input)).rejects.toThrow('uprawnień');
  stopMeals();
  await clearDatabase();
  await activateOfflineAccount(account);
  await restoreMeals(client, session);
  expect(visibleMeals().weeks).toEqual({});
  expect(await operations()).toEqual([]);
});

it('does not apply a late response after changing accounts', async () => {
  await queueMeal(week, input);
  stopMeals();
  let release: (value: unknown) => void = () => {};
  const send = vi.fn(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  onlineManager.setOnline(true);
  const sender = startSync(account, [{ ...mealAdapter(account), prepare: async () => {}, send }], () => {});
  senders.push(sender);
  await vi.waitFor(() => expect(send).toHaveBeenCalled());
  await clearDatabase();
  const next = { ...session, user: { ...session.user, id: crypto.randomUUID() } };
  await activateOfflineAccount(`${familyId}:${next.user.id}`);
  await restoreMeals(client, next);
  release({ week: baseWeek() });
  await sender.synchronize();
  expect(visibleMeals().weeks).toEqual({});
});

it('requires explicit confirmation after a server repeat conflict and preserves dependent work', async () => {
  await queueMeal(week, input);
  const meal = visibleMeals().weeks[week]!.data.days[0]!.meals[0]!;
  const exported = await queueMealExport(week, listId, [meal.id], false);
  await queueMeal(week, { ...input, title: 'Późniejsza zmiana' });
  await transact('readwrite', async (tx) => {
    for (const op of await readOperations(tx, account))
      tx.objectStore('outbox').put({
        ...op,
        status: 'needs-review',
        reviewReason: op.operationId === exported.operationId ? 'MEAL_EXPORT_CONFIRMATION_REQUIRED' : 'dependency',
      });
  });
  await confirmMealExport(exported.operationId);
  const op = (await operations()).find((op) => op.operationId === exported.operationId)!;
  expect(op).toMatchObject({ status: 'pending', payload: { data: { confirmRepeat: true } } });
  expect(op.submittedAt).toBeGreaterThan(0);
});

it('retains a rejected export on access loss and discards dependent work only on an explicit decision', async () => {
  await queueMeal(week, input);
  const meal = visibleMeals().weeks[week]!.data.days[0]!.meals[0]!;
  const exported = await queueMealExport(week, listId, [meal.id], false);
  await queueMeal(week, { ...input, title: 'Późniejszy zapis' });
  const before = await operations();
  await transact('readwrite', async (tx) => {
    const op = (await readOperations(tx, account)).find((op) => op.operationId === exported.operationId)!;
    tx.objectStore('outbox').put({ ...op, status: 'needs-review', reviewReason: 'rejected' });
    await mealAdapter(account).invalidateAccess(tx, op, new ApiRequestError('Brak listy', 404, 'NOT_FOUND'));
  });
  expect(await operations()).toHaveLength(before.length);
  const shopping = await transact('readonly', (tx) => readShoppingTransaction(tx, account));
  expect(shopping!.revokedLists).toContain(listId);
  await discardMealOperation(exported.operationId);
  expect((await operations()).map((op) => op.operationId)).toEqual([before[0]!.operationId]);
});
