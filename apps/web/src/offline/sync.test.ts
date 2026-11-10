import './testSetup.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onlineManager } from '@tanstack/react-query';
import { Capacitor } from '@capacitor/core';
import { IDBDatabase } from 'fake-indexeddb';
import { OFFLINE_REPLAY_MAX_AGE_MS } from '@rodzina/shared';
import { ApiRequestError } from '../api.js';
import { invalidateSessionRequests } from '../platform.js';
import type { AccountSession } from '../session.js';
import { activateOfflineAccount, transact, clearDatabase, requestValue } from './database.js';
import { appendOperation, readOperations } from './outbox.js';
import { joinSync, retryAt, startSync, type SyncAdapter } from './sync.js';
import * as status from './status.js';
import { OUTBOX_SIGNAL } from './signals.js';

const account = 'family:user';
const session = { user: { id: 'user' }, family: { id: 'family' } } as AccountSession;
const senders: ReturnType<typeof startSync>[] = [];
const read = () => transact('readonly', (tx) => readOperations(tx, account));
const enqueue = (operationId: string, orderingKey: string) =>
  transact('readwrite', (tx) =>
    appendOperation(tx, account, 'shopping', {
      operationId,
      submittedAt: Date.now(),
      entityId: 'item',
      payload: { name: 'Mleko' },
      orderingKeys: [orderingKey],
    }),
  );
async function seed() {
  await activateOfflineAccount(account);
  await enqueue('stable-id', 'list:a');
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
  vi.useRealTimers();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});
describe('shared account sender', () => {
  it('does not read or write IDB while an empty sender is idle, including unrelated storage events', async () => {
    await activateOfflineAccount(account);
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const sender = start();
    await sender.synchronize();
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction').mockClear();
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: 'value' }));
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: OUTBOX_SIGNAL,
        newValue: JSON.stringify({ accountId: 'another:account' }),
      }),
    );
    await vi.advanceTimersByTimeAsync(60000);
    expect(transactions).not.toHaveBeenCalled();
    transactions.mockRestore();
    expect(
      await transact('readonly', (tx) => requestValue(tx.objectStore('metadata').get([account, 'sender-lease']))),
    ).toBeUndefined();
  });
  it('wakes an idle sender after a committed append without a manual wake', async () => {
    await activateOfflineAccount(account);
    const send = vi.fn(async () => ({}));
    const sender = start({ send });
    await sender.synchronize();
    await seed();
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    await sender.synchronize();
    expect(await read()).toEqual([]);
  });
  it('does not announce an aborted append', async () => {
    await activateOfflineAccount(account);
    const signal = vi.fn();
    window.addEventListener(OUTBOX_SIGNAL, signal);
    try {
      await expect(
        transact('readwrite', async (tx) => {
          await appendOperation(tx, account, 'shopping', {
            operationId: 'aborted',
            submittedAt: Date.now(),
            entityId: 'item',
            payload: {},
            orderingKeys: ['list:a'],
          });
          throw new Error('Abort append');
        }),
      ).rejects.toThrow('Abort append');
      expect(signal).not.toHaveBeenCalled();
      expect(await read()).toEqual([]);
    } finally {
      window.removeEventListener(OUTBOX_SIGNAL, signal);
    }
  });
  it('sleeps until persisted retry is due and resumes it automatically after restart', async () => {
    await seed();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const first = start({
      send: async () => {
        throw new ApiRequestError('Retry', 429, undefined, 60000);
      },
    });
    await first.synchronize();
    first.stop();
    const send = vi.fn(async () => ({}));
    const second = start({ send });
    await second.synchronize();
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction').mockClear();
    await vi.advanceTimersByTimeAsync(59000);
    expect(transactions).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await second.synchronize();
    expect(send).toHaveBeenCalledOnce();
    expect(await read()).toEqual([]);
  });
  it('cancels a queued request while another sender still holds the lock', async () => {
    await seed();
    const request = vi.spyOn(navigator.locks, 'request');
    const first = start({ send: () => new Promise(() => {}) });
    const firstRun = first.synchronize();
    await vi.waitFor(async () => expect((await read())[0]?.status).toBe('sending'));
    const send = vi.fn(async () => ({}));
    const waiting = start({ send });
    const waitingRun = waiting.synchronize();
    await vi.waitFor(() => expect(request.mock.calls.filter(([name]) => name === `sync:${account}`)).toHaveLength(2));
    waiting.stop();
    await waitingRun;
    expect(send).not.toHaveBeenCalled();
    first.stop();
    await firstRun;
    expect((await read())[0]?.operationId).toBe('stable-id');
  });
  it.each(['missing', 'denied'])('keeps the queue intact when Web Locks are %s', async (availability) => {
    await seed();
    const locks = navigator.locks;
    const request = locks.request.bind(locks) as typeof locks.request;
    const issue = vi.spyOn(status, 'reportStorageIssue');
    const send = vi.fn(async () => ({}));
    if (availability === 'missing') Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    else {
      vi.spyOn(locks, 'request').mockImplementation(((name: string, ...args: unknown[]) => {
        if (name === `sync:${account}`) return Promise.reject(new DOMException('Denied', 'SecurityError'));
        return Reflect.apply(request, locks, [name, ...args]);
      }) as typeof locks.request);
    }
    const sender = start({ send });
    await sender.synchronize();
    expect(issue).toHaveBeenCalledWith(expect.stringContaining('Nie można zsynchronizować zmian.'));
    expect(send).not.toHaveBeenCalled();
    Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
    vi.restoreAllMocks();
    expect(await read()).toMatchObject([{ operationId: 'stable-id', status: 'pending', attempts: 0 }]);
    window.dispatchEvent(new Event('focus'));
    await sender.synchronize();
    expect(send).toHaveBeenCalledOnce();
  });
  it('handles account storage notifications and releases timers when stopped', async () => {
    onlineManager.setOnline(false);
    await seed();
    const send = vi.fn(async () => ({}));
    const sender = start({ send });
    await sender.synchronize();
    onlineManager.setOnline(true);
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: OUTBOX_SIGNAL,
        newValue: JSON.stringify({ accountId: account }),
      }),
    );
    await sender.synchronize();
    expect(send).toHaveBeenCalledOnce();
    sender.stop();
    await sender.synchronize();
    const transactions = vi.spyOn(IDBDatabase.prototype, 'transaction').mockClear();
    window.dispatchEvent(new CustomEvent(OUTBOX_SIGNAL, { detail: account }));
    expect(transactions).not.toHaveBeenCalled();
  });
  it('expires a waiting retry at the age deadline without sending or reviving it after clock correction', async () => {
    await seed();
    const now = Date.now();
    await transact('readwrite', async (tx) => {
      const op = (await readOperations(tx, account))[0]!;
      tx.objectStore('outbox').put({
        ...op,
        submittedAt: now - OFFLINE_REPLAY_MAX_AGE_MS + 1000,
        status: 'retry-wait',
        nextAttemptAt: now + 60000,
      });
    });
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const send = vi.fn(async () => ({}));
    const sender = start({ send });
    await sender.synchronize();
    await vi.advanceTimersByTimeAsync(1001);
    await sender.synchronize();
    expect(send).not.toHaveBeenCalled();
    expect((await read())[0]).toMatchObject({ status: 'needs-review', reviewReason: 'expired' });
    vi.setSystemTime(now - 60000);
    await sender.synchronize();
    expect((await read())[0]?.status).toBe('needs-review');
  });
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
    const locks = vi.spyOn(navigator.locks, 'request');
    const adapter = (module: string): SyncAdapter => ({
      module,
      prepare: async () => {},
      reconcile: async () => {},
      invalidateAccess: async () => {},
      send: async (op) => {
        maximum = Math.max(maximum, ++concurrent);
        sent.push(op.operationId);
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
    expect(locks.mock.calls.filter(([name]) => name === `sync:${account}`)).toHaveLength(1);
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
  it.each([
    [401, undefined],
    [409, 'SESSION_CHANGED'],
  ] as const)('stops on %s %s without sending another operation', async (status, code) => {
    await seed();
    await enqueue('other-id', 'list:b');
    const lost = vi.fn();
    window.addEventListener('rodzina:session-lost', lost);
    const send = vi.fn(async () => {
      throw new ApiRequestError('Sesja wygasła', status, code);
    });
    try {
      start({ send, sessionTransport: async () => session });
      await vi.waitFor(() => expect(lost).toHaveBeenCalledOnce());
      expect(send).toHaveBeenCalledOnce();
      expect(await read()).toHaveLength(2);
    } finally {
      window.removeEventListener('rodzina:session-lost', lost);
    }
  });
  it.each(['403', 'transport failure', 'offline and online', 'session generation change'] as const)(
    'confirms again before independent work after %s',
    async (interruption) => {
      onlineManager.setOnline(false);
      vi.spyOn(Math, 'random').mockReturnValue(1);
      vi.useFakeTimers({ toFake: ['Date'] });
      await seed();
      await enqueue('other-id', 'list:b');
      const requests: string[] = [];
      const sender = start({
        sessionTransport: async (path) => {
          requests.push(path);
          return session;
        },
        send: async ({ operationId }) => {
          requests.push(operationId);
          if (operationId === 'stable-id') {
            if (interruption === '403') throw new ApiRequestError('Brak dostępu', 403);
            if (interruption === 'transport failure') throw new TypeError('Network lost');
            if (interruption === 'offline and online') {
              onlineManager.setOnline(false);
              onlineManager.setOnline(true);
              throw new TypeError('Network lost');
            }
            if (interruption === 'session generation change') invalidateSessionRequests();
          }
          return {};
        },
      });
      onlineManager.setOnline(true);
      await sender.synchronize();
      expect(requests).toEqual(['/api/auth/me', 'stable-id', '/api/auth/me', 'other-id']);
      expect(await read()).toMatchObject([
        { operationId: 'stable-id', status: interruption === '403' ? 'needs-review' : 'retry-wait' },
      ]);
    },
  );
  it('does not reuse a completed run’s confirmation for newly queued work', async () => {
    await seed();
    const sessionTransport = vi.fn(async () => session);
    const sender = start({ sessionTransport });
    await sender.synchronize();
    expect(sessionTransport).toHaveBeenCalledOnce();
    await enqueue('later-id', 'list:a');
    await sender.synchronize();
    expect(sessionTransport).toHaveBeenCalledTimes(2);
    expect(await read()).toEqual([]);
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
    window.dispatchEvent(new Event('offline-account-changed'));
    await clearDatabase();
    await activateOfflineAccount('family:another-user', true);
    finish({});
    await new Promise((resolve) => setTimeout(resolve, 20));
    await sender.synchronize();
    expect(reconcile).not.toHaveBeenCalled();
    expect(await transact('readonly', (tx) => readOperations(tx, 'family:another-user'))).toEqual([]);
  });
  it('bounds exponential jitter and honors Retry-After', () => {
    expect(retryAt(0, 0, 1000, 0.5)).toBe(2500);
    expect(retryAt(100, 0, 1000, 1)).toBe(301000);
    expect(retryAt(0, 60000, 1000, 0)).toBe(61000);
  });
  it.each(['WWW', 'Android'])('hands off the same operation after stopping a %s sender', async (platform) => {
    await seed();
    if (platform === 'Android') vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    const locks = vi.spyOn(navigator.locks, 'request');
    let respond!: (value: unknown) => void;
    const response = new Promise((resolve) => {
      respond = resolve;
    });
    const sendFirst = vi.fn<SyncAdapter['send']>(() => response);
    const reconcileFirst = vi.fn(async () => {});
    const first = start({ send: sendFirst, reconcile: reconcileFirst });
    const firstRun = first.synchronize();
    await vi.waitFor(() => expect(sendFirst).toHaveBeenCalledOnce());
    const sendNext = vi.fn<SyncAdapter['send']>(async () => ({}));
    const sessionTransport = vi.fn(async () => session);
    const next = start({ send: sendNext, sessionTransport });
    const nextRun = next.synchronize();
    first.stop();
    expect(sendFirst.mock.calls[0]![1].aborted).toBe(true);
    if (platform === 'Android') {
      await next.refreshStatus();
      expect(sendNext).not.toHaveBeenCalled();
      respond({});
    }
    await Promise.all([firstRun, nextRun]);
    respond({});
    expect(reconcileFirst).not.toHaveBeenCalled();
    expect(sendNext).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ operationId: 'stable-id' }),
      expect.any(AbortSignal),
      { session },
    );
    expect(sessionTransport).toHaveBeenCalledOnce();
    expect(await read()).toEqual([]);
    if (platform === 'Android') expect(locks.mock.calls.some(([name]) => name.startsWith('sync:'))).toBe(false);
  });
});
