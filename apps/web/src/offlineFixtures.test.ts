import './offline/testSetup.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onlineManager, QueryClient, type DehydratedState } from '@tanstack/react-query';
import { z } from 'zod';
import {
  contactsResponseSchema,
  createShoppingItemSchema,
  createShoppingListSchema,
  eventSchema,
  OFFLINE_REPLAY_MAX_AGE_MS,
  patchShoppingItemSchema,
  shoppingItemSchema,
  shoppingListSchema,
  taskListSchema,
  taskSchema,
} from '@rodzina/shared';
import { hydrateOfflineData, offlineDataSchema } from './offlineData.js';
import { CalendarOfflineStore, readCalendarRange } from './features/calendar/calendarOffline.js';
import { createContactsStore } from './features/contacts/contactsOffline.js';
import { createTaskOfflineStore } from './features/tasks/taskOffline.js';
import {
  restoreShopping,
  stopShoppingPersistence,
  type QueuedShoppingChange,
} from './features/shopping/shoppingOffline.js';

const fixture = z
  .object({
    fixtureVersion: z.literal(1),
    referenceTime: z.number().int().positive(),
    accountId: z.string(),
    ids: z.record(z.string()),
    keys: z.record(z.string()),
    entries: z.array(z.object({ key: z.string(), value: z.unknown() })),
    expected: z.object({
      pendingShoppingIds: z.array(z.string().uuid()),
      pendingTaskIds: z.array(z.string().uuid()),
      discardedIds: z.array(z.string().uuid()),
      blockedTaskIds: z.array(z.string().uuid()),
    }),
  })
  .parse(JSON.parse(readFileSync(resolve('docs/offline/fixtures/legacy-valid.json'), 'utf8')));
const scenarios = z
  .object({
    fixtureVersion: z.literal(1),
    base: z.literal('legacy-valid.json'),
    cases: z.array(
      z.object({
        id: z.string(),
        changes: z.array(
          z.object({
            key: z.string(),
            path: z
              .array(z.union([z.string(), z.number().int().nonnegative()]))
              .min(1)
              .optional(),
            value: z.unknown().optional(),
            raw: z.string().optional(),
            remove: z.boolean().optional(),
          }),
        ),
        expectedMigration: z.string().min(1),
        readerCheck: z.string(),
      }),
    ),
  })
  .parse(JSON.parse(readFileSync(resolve('docs/offline/fixtures/legacy-cases.json'), 'utf8')));
const variants = z
  .object({
    fixtureVersion: z.literal(1),
    accountId: z.string(),
    independentExamples: z.literal(true),
    shopping: z.array(
      z.object({
        key: z.string(),
        value: z.object({
          state: z.object({
            variables: z.object({
              operationId: z.string().uuid(),
              change: z.discriminatedUnion('type', [
                createShoppingListSchema.extend({ type: z.literal('createList'), id: z.string().uuid() }),
                createShoppingListSchema.extend({ type: z.literal('renameList'), id: z.string().uuid() }),
                z.object({ type: z.literal('deleteList'), id: z.string().uuid() }),
                z.object({
                  type: z.literal('add'),
                  id: z.string().uuid(),
                  listId: z.string().uuid(),
                  data: createShoppingItemSchema,
                }),
                z.object({
                  type: z.literal('edit'),
                  id: z.string().uuid(),
                  listId: z.string().uuid(),
                  data: patchShoppingItemSchema,
                }),
                z.object({ type: z.literal('remove'), id: z.string().uuid(), listId: z.string().uuid() }),
                z.object({ type: z.literal('clear'), listId: z.string().uuid() }),
              ]),
            }),
          }),
        }),
      }),
    ),
    tasks: z.array(z.object({ key: z.string(), value: z.unknown() })),
  })
  .parse(JSON.parse(readFileSync(resolve('docs/offline/fixtures/operation-variants.json'), 'utf8')));

const required = (record: Record<string, string>, name: string) => {
  const value = record[name];
  if (!value) throw new Error(`Missing fixture field: ${name}`);
  return value;
};
const key = (name: string) => required(fixture.keys, name);
const id = (name: string) => required(fixture.ids, name);
const clients: QueryClient[] = [];
const read = (name: string): unknown => JSON.parse(localStorage.getItem(key(name))!);
const record = (value: unknown) => z.record(z.unknown()).parse(value);
const mutation = (name: string) =>
  z.object({ state: z.object({ variables: z.unknown() }) }).parse(read(name)).state.variables;
const snapshot = () => read('shopping') as { clientState: DehydratedState };

function seed(scenario?: (typeof scenarios.cases)[number]) {
  localStorage.clear();
  for (const entry of fixture.entries) localStorage.setItem(entry.key, JSON.stringify(entry.value));
  for (const change of scenario?.changes ?? []) {
    if (change.path) {
      const value: unknown = JSON.parse(localStorage.getItem(change.key)!);
      let cursor = value;
      for (const segment of change.path.slice(0, -1)) {
        if (!cursor || typeof cursor !== 'object') throw new Error('Invalid fixture path');
        cursor = (cursor as Record<string, unknown>)[String(segment)];
      }
      if (!cursor || typeof cursor !== 'object') throw new Error('Invalid fixture target');
      const field = String(change.path.at(-1));
      if (change.remove) delete (cursor as Record<string, unknown>)[field];
      else (cursor as Record<string, unknown>)[field] = change.value;
      localStorage.setItem(change.key, JSON.stringify(value));
    } else if (change.remove) localStorage.removeItem(change.key);
    else localStorage.setItem(change.key, change.raw ?? JSON.stringify(change.value));
  }
}

beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(fixture.referenceTime);
  onlineManager.setOnline(false);
  seed();
});
afterEach(async () => {
  for (const client of clients.splice(0)) {
    stopShoppingPersistence(client);
    client.clear();
  }
  localStorage.clear();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

describe('O.1 legacy storage fixtures', () => {
  it('covers every existing shopping change and task operation using current domain schemas and readers', async () => {
    expect(variants.shopping.map((entry) => entry.value.state.variables.change.type)).toEqual([
      'createList',
      'renameList',
      'deleteList',
      'add',
      'edit',
      'remove',
      'clear',
    ]);
    for (const entry of variants.shopping) {
      const { operationId, change } = entry.value.state.variables;
      expect(entry.key).toBe(`rodzina:shopping:v1:operation:${fixture.accountId}:${operationId}`);
      if (change.type === 'add' || change.type === 'createList') expect(change.id).toBe(operationId);
    }
    const types = [];
    for (const entry of variants.tasks) {
      seed();
      for (const name of [key('taskEdit'), key('taskDiscarded'), key('discard')]) localStorage.removeItem(name);
      localStorage.setItem(entry.key, JSON.stringify(entry.value));
      const store = createTaskOfflineStore();
      await store.activate(fixture.accountId);
      expect(store.getSnapshot().error).toBeUndefined();
      const operation = store.getSnapshot().pending[0]!;
      expect(entry.key).toBe(`rodzina:tasks:v1:operation:${fixture.accountId}:${operation.id}`);
      types.push(operation.change.type);
    }
    expect(types).toEqual(['create', 'update', 'remove']);
  });

  it('restores the five current formats, including calendar details and discard precedence', async () => {
    const { ensureMigrated } = await import('./offline/database.js');
    await ensureMigrated(true);
    const saved = await hydrateOfflineData();
    expect(saved?.session.user.id).toBe(id('user'));
    expect(saved?.session.family.joinCode).toBe('TEST-CODE');
    expect(saved?.members).toHaveLength(1);
    const calendar = new CalendarOfflineStore();
    await calendar.activate(fixture.accountId);
    expect(calendar.issue).toBeUndefined();
    expect(eventSchema.parse(calendar.snapshot().details[id('event')]?.event).id).toBe(id('event'));
    expect(calendar.snapshot().personal[id('event')]?.[0]?.userId).toBe(id('user'));
    expect(
      readCalendarRange(calendar.snapshot(), { from: '2026-10-26', to: '2026-10-26' }, 'Europe/Warsaw'),
    ).toMatchObject({ coverage: 'complete', data: [expect.objectContaining({ eventId: id('event') })] });
    const contacts = createContactsStore();
    contacts.activate(fixture.accountId);
    expect(contacts.snapshot().issue).toBeUndefined();
    expect(contactsResponseSchema.parse(contacts.snapshot().saved?.data).contacts[0]?.id).toBe(id('contact'));
    const tasks = createTaskOfflineStore();
    tasks.activate(fixture.accountId);
    expect(tasks.getSnapshot().error).toBeUndefined();
    expect(taskListSchema.parse(tasks.getSnapshot().lists?.[0]).id).toBe(id('taskList'));
    expect(taskSchema.parse(tasks.getSnapshot().items[id('taskList')]?.[0]).isDone).toBe(false);
    expect(tasks.project().items[id('taskList')]?.[0]?.isDone).toBe(true);
    expect(tasks.getSnapshot().pending.map((op) => op.id)).toEqual(fixture.expected.pendingTaskIds);
    expect(tasks.blockedTasks(fixture.accountId)).toEqual(fixture.expected.blockedTaskIds);
    expect(() => tasks.enqueue(id('taskList'), id('task'), { type: 'update', data: { title: 'New' } })).toThrow(
      /odrzuceniu zmian/,
    );
    const client = new QueryClient();
    clients.push(client);
    await restoreShopping(client, saved!.session);
    const prefix = ['shopping', id('family'), id('user')];
    expect(shoppingListSchema.parse(client.getQueryData<unknown[]>([...prefix, 'lists'])?.[0]).id).toBe(
      id('shoppingList'),
    );
    expect(
      shoppingItemSchema.parse(client.getQueryData<unknown[]>([...prefix, 'items', id('shoppingList')])?.[0]).id,
    ).toBe(id('milk'));
    expect(
      client
        .getMutationCache()
        .getAll()
        .map((entry) => (entry.state.variables as QueuedShoppingChange).operationId),
    ).toEqual(fixture.expected.pendingShoppingIds);
  });

  it('keeps fixture identities unique and measures synthetic data within the declared budgets', async () => {
    expect(new Set(fixture.entries.map((entry) => entry.key)).size).toBe(fixture.entries.length);
    expect(new Set(scenarios.cases.map((scenario) => scenario.id)).size).toBe(scenarios.cases.length);
    const sizes: Record<string, number> = {};
    for (const entry of fixture.entries) {
      const charge = 2 * Buffer.byteLength(JSON.stringify([entry.key, entry.value]), 'utf8') + 256;
      const module = entry.key.split(':')[1]!;
      sizes[module] = (sizes[module] ?? 0) + charge;
    }
    for (const size of Object.values(sizes)) expect(size).toBeLessThan(2 * 1048576);
    console.info('Synthetic legacy fixture charged bytes:', JSON.stringify(sizes));
  });

  it.each(scenarios.cases)('provides a reproducible source case: $id', async (scenario) => {
    seed(scenario);
    switch (scenario.readerCheck) {
      case 'family-invalid':
        expect(() => offlineDataSchema.parse(JSON.parse(localStorage.getItem('rodzina:offline-data:v1')!))).toThrow();
        break;
      case 'contacts-invalid': {
        const store = createContactsStore();
        await store.activate(fixture.accountId);
        expect(store.snapshot().saved).toBeUndefined();
        expect(store.snapshot().issue).toMatch(/Nie można odczytać/);
        break;
      }
      case 'invalid-json':
        expect(() => read('shoppingAdd')).toThrow(SyntaxError);
        break;
      case 'shopping-conflict':
        expect(mutation('shoppingAdd')).not.toEqual(snapshot().clientState.mutations[0]?.state.variables);
        break;
      case 'shopping-snapshot-only':
        expect(localStorage.getItem(key('shoppingAdd'))).toBeNull();
        expect(snapshot().clientState.mutations[0]?.state.variables).toMatchObject({ operationId: id('bread') });
        break;
      case 'shopping-journal-only':
        expect(localStorage.getItem(key('shopping'))).toBeNull();
        expect(mutation('shoppingAdd')).toMatchObject({ operationId: id('bread') });
        break;
      case 'shopping-in-flight':
        expect(record(record(read('shoppingAdd')).state).isPaused).toBe(false);
        expect(mutation('shoppingAdd')).toEqual(snapshot().clientState.mutations[0]?.state.variables);
        break;
      case 'shopping-tie':
        expect(record(mutation('shoppingAdd')).submittedAt).toBe(record(mutation('shoppingEdit')).submittedAt);
        expect(snapshot().clientState.mutations).toEqual([]);
        break;
      case 'task-missing':
      case 'task-tie':
      case 'task-pending':
      case 'task-expired': {
        const store = createTaskOfflineStore();
        await store.activate(fixture.accountId);
        expect(store.getSnapshot().error).toBeUndefined();
        const pending = store.getSnapshot().pending;
        if (scenario.readerCheck === 'task-missing') {
          expect(store.project().items[id('taskList')]).toBeUndefined();
          expect(pending.map((op) => op.id)).toEqual(fixture.expected.pendingTaskIds);
        } else if (scenario.readerCheck === 'task-tie') {
          expect(pending.map((op) => op.id)).toEqual([id('taskEdit'), id('taskRemove')]);
          expect(pending[0]?.submittedAt).toBe(pending[1]?.submittedAt);
        } else if (scenario.readerCheck === 'task-pending') {
          expect(pending[0]?.status).toBe('pending');
        } else {
          expect(pending[0]).toMatchObject({ id: id('taskEdit'), status: 'needs-review', reason: 'expired' });
          if (scenario.id === 'task-expired')
            expect(fixture.referenceTime - pending[0]!.submittedAt).toBeGreaterThan(OFFLINE_REPLAY_MAX_AGE_MS);
          vi.mocked(Date.now).mockReturnValue(fixture.referenceTime - 40 * 86400000);
          store.reload();
          expect(store.getSnapshot().pending[0]?.status).toBe('needs-review');
        }
        break;
      }
      default:
        throw new Error(`Missing source assertion: ${scenario.readerCheck}`);
    }
  });
});
