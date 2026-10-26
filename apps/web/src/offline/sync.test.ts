import './testSetup.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onlineManager } from '@tanstack/react-query';
import { ApiRequestError } from '../api.js';
import { activateOfflineAccount, transact, clearDatabase, requestValue } from './database.js';
import { appendOperation, readOperations, type Lease } from './outbox.js';
import { joinSync, retryAt, startSync, type SyncAdapter } from './sync.js';

const account = 'family:user';
const senders: ReturnType<typeof startSync>[] = [];
const read = () => transact('readonly', (tx) => readOperations(tx, account));
async function seed() {
  await activateOfflineAccount(account);
  await transact('readwrite', (tx) =>
    appendOperation(tx, account, 'shopping', {
      operationId: 'stable-id',
      submittedAt: Date.now(),
      entityId: 'item',
      payload: { name: 'Mleko' },
      orderingKeys: ['list:a'],
    }),
  );
}
function start(overrides: Partial<SyncAdapter> = {}) {
  const adapter: SyncAdapter = {
    module: 'shopping',
    prepare: async () => {},
    send: async () => ({}),
    reconcile: async () => {},
    invalidateAccess: async () => {},
    ...overrides,
  };
  const sender = startSync(account, [adapter], () => {});
  senders.push(sender);
  return sender;
}
afterEach(() => {
  senders.splice(0).forEach((sender) => sender.stop());
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});
describe('shared account sender', () => {
  it('shares one sender across modules, retains cross-module dependencies and continues independent work', async () => {
    onlineManager.setOnline(false);
    await seed();
    await transact('readwrite', async (tx) => {
      await appendOperation(tx, account, 'tasks', {
        operationId: 'dependent-task',
        submittedAt: Date.now(),
        entityId: 'dependent',
        payload: {},
        orderingKeys: ['task:a'],
        dependsOn: ['stable-id'],
      });
      await appendOperation(tx, account, 'tasks', {
        operationId: 'independent-task',
        submittedAt: Date.now(),
        entityId: 'independent',
        payload: {},
        orderingKeys: ['task:b'],
      });
    });
    let concurrent = 0;
    let maximum = 0;
    const sent: string[] = [];
    const owners: string[] = [];
    const adapter = (module: string): SyncAdapter => ({
      module,
      prepare: async () => {},
      reconcile: async () => {},
      invalidateAccess: async () => {},
      send: async (op) => {
        maximum = Math.max(maximum, ++concurrent);
        sent.push(op.operationId);
        owners.push(
          await transact(
            'readonly',
            async (tx) =>
              (await requestValue<{ value: Lease }>(tx.objectStore('metadata').get([account, 'sender-lease']))).value
                .owner,
          ),
        );
        concurrent--;
        if (op.operationId === 'stable-id') throw new ApiRequestError('Konflikt', 409);
        return {};
      },
    });
    const shopping = joinSync(account, adapter('shopping'), () => {});
    const tasks = joinSync(account, adapter('tasks'), () => {});
    senders.push(shopping, tasks);
    onlineManager.setOnline(true);
    await tasks.synchronize();
    expect(sent).toEqual(['stable-id', 'independent-task']);
    expect(maximum).toBe(1);
    expect(new Set(owners).size).toBe(1);
    expect((await read()).map((op) => [op.operationId, op.reviewReason, op.dependsOn])).toEqual([
      ['stable-id', 'conflict', []],
      ['dependent-task', 'dependency', ['stable-id']],
    ]);
    shopping.stop();
    await transact('readwrite', (tx) =>
      appendOperation(tx, account, 'tasks', {
        operationId: 'after-shopping-unmount',
        submittedAt: Date.now(),
        entityId: 'other',
        payload: {},
        orderingKeys: ['task:c'],
      }),
    );
    await tasks.synchronize();
    expect(sent.at(-1)).toBe('after-shopping-unmount');
  });
  it('does not let an unmounted module block independent registered work', async () => {
    onlineManager.setOnline(false);
    await seed();
    await transact('readwrite', (tx) =>
      appendOperation(tx, account, 'tasks', {
        operationId: 'available-task',
        submittedAt: Date.now(),
        entityId: 'other',
        payload: {},
        orderingKeys: ['task:b'],
      }),
    );
    const send = vi.fn(async () => ({}));
    const sender = joinSync(
      account,
      { module: 'tasks', prepare: async () => {}, send, reconcile: async () => {}, invalidateAccess: async () => {} },
      () => {},
    );
    senders.push(sender);
    onlineManager.setOnline(true);
    await sender.synchronize();
    expect(send).toHaveBeenCalledOnce();
    expect((await read()).map((op) => op.operationId)).toEqual(['stable-id']);
  });
  it.each([429, 503])('persists %s retry across sender restart without changing identity', async (status) => {
    await seed();
    const before = (await read())[0]!;
    const first = start({
      send: async () => {
        throw new ApiRequestError('Retry', status, undefined, 60000);
      },
    });
    await vi.waitFor(async () => expect((await read())[0]?.status).toBe('retry-wait'));
    const saved = (await read())[0]!;
    expect(saved.nextAttemptAt).toBeGreaterThan(Date.now() + 59000);
    first.stop();
    const send = vi.fn(async () => ({}));
    start({ send });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(send).not.toHaveBeenCalled();
    expect((await read())[0]).toMatchObject({
      operationId: before.operationId,
      submittedAt: before.submittedAt,
      attempts: 1,
      nextAttemptAt: saved.nextAttemptAt,
    });
  });
  it('replays server success after local commit failure using the same operation ID', async () => {
    await seed();
    const seen: string[] = [];
    const first = start({
      send: async (operation) => {
        seen.push(operation.operationId);
        return {};
      },
      reconcile: async () => {
        throw new Error('Commit failed');
      },
    });
    await vi.waitFor(async () => expect((await read())[0]?.status).toBe('retry-wait'));
    first.stop();
    await transact('readwrite', async (tx) => {
      const op = (await readOperations(tx, account))[0]!;
      tx.objectStore('outbox').put({ ...op, nextAttemptAt: 0 });
    });
    start({
      send: async (op) => {
        seen.push(op.operationId);
        return {};
      },
    });
    await vi.waitFor(async () => expect(await read()).toHaveLength(0));
    expect(seen).toEqual(['stable-id', 'stable-id']);
  });
  it('keeps a conflict and continues unrelated work', async () => {
    await seed();
    await transact('readwrite', (tx) =>
      appendOperation(tx, account, 'shopping', {
        operationId: 'other-id',
        submittedAt: Date.now(),
        entityId: 'other',
        payload: {},
        orderingKeys: ['list:b'],
      }),
    );
    start({
      send: async (op) => {
        if (op.operationId === 'stable-id') throw new ApiRequestError('Konflikt', 409, 'OPERATION_CONFLICT');
        return {};
      },
    });
    await vi.waitFor(async () => {
      const operations = await read();
      expect(operations).toHaveLength(1);
      expect(operations[0]).toMatchObject({ status: 'needs-review', reviewReason: 'conflict' });
    });
  });
  it('stops on 401 without sending another operation', async () => {
    await seed();
    const lost = vi.fn();
    window.addEventListener('rodzina:session-lost', lost);
    const send = vi.fn(async () => {
      throw new ApiRequestError('Sesja wygasła', 401);
    });
    try {
      start({ send });
      await vi.waitFor(() => expect(lost).toHaveBeenCalledOnce());
      expect(send).toHaveBeenCalledOnce();
      expect(await read()).toHaveLength(1);
    } finally {
      window.removeEventListener('rodzina:session-lost', lost);
    }
  });
  it('cannot reconcile a late response after account clearing', async () => {
    await seed();
    let finish!: (value: unknown) => void;
    const reconcile = vi.fn(async () => {});
    const sender = start({
      send: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      reconcile,
    });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    sender.stop();
    await clearDatabase();
    finish({});
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reconcile).not.toHaveBeenCalled();
    expect(await read()).toEqual([]);
  });
  it('bounds exponential jitter and honors Retry-After', () => {
    expect(retryAt(0, 0, 1000, 0.5)).toBe(2500);
    expect(retryAt(100, 0, 1000, 1)).toBe(301000);
    expect(retryAt(0, 60000, 1000, 0)).toBe(61000);
  });
  it('fences a late response after another tab takes over the lease', async () => {
    await seed();
    let finish!: (value: unknown) => void;
    const reconcile = vi.fn(async () => {});
    start({
      send: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      reconcile,
    });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await transact('readwrite', async (tx) => {
      const store = tx.objectStore('metadata');
      const old = (await requestValue<{ value: Lease }>(store.get([account, 'sender-lease']))).value;
      store.put({
        accountId: account,
        key: 'sender-lease',
        value: { ...old, epoch: old.epoch + 1, owner: 'replacement', expiresAt: Date.now() + 60000 },
      });
    });
    finish({});
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reconcile).not.toHaveBeenCalled();
    expect((await read())[0]?.operationId).toBe('stable-id');
  });
});
