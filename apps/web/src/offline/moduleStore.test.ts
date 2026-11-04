import './testSetup.js';
import { onlineManager } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { clearAccountData, registerAccountStore, restoreAccountStores } from '../accountStorage.js';
import type { AccountSession } from '../session.js';
import { clearDatabase, readCache, transact, writeCache } from './database.js';
import { cacheSignal, registerOfflineModule } from './moduleStore.js';
import { appendOperation, readOperations } from './outbox.js';

const account = 'family:user';
const anotherAccount = 'family:another-user';
type Snapshot = { account: string; value: string };
const cache = {
  schemaVersion: 1,
  legacyKey: 'offline-module-test:v1',
  budget: 4096,
  parseCache: (value: unknown) => value as Snapshot,
  trim: (value: unknown) => value,
  describe: () => ({ syncedAt: 1, coverage: 'complete' as const }),
} as const;
const readError = (detail: string) => detail;
const testModule = registerOfflineModule({
  mode: 'read-only',
  cache: { ...cache, module: 'calendar' },
  project: (snapshot: Snapshot) => snapshot.value,
  readError,
  writeError: readError,
});
const save = (store: ReturnType<typeof testModule.createStore>, load: () => Promise<string>) =>
  store.fetchSnapshot(account, load, (value) => ({ account, value }));
function delayedResponse() {
  let finish!: (value: string) => void;
  const promise = new Promise<string>((resolve) => {
    finish = resolve;
  });
  return { promise, finish };
}

describe('offline module store', () => {
  it('loads a saved snapshot and publishes a stable projected view on account activation', async () => {
    const store = testModule.createStore();
    await store.activate(account);
    await save(store, async () => 'saved');
    const restarted = testModule.createStore();
    const listener = vi.fn();
    const unsubscribe = restarted.subscribe(listener);
    try {
      await restarted.activate(account);
      const state = restarted.snapshot();
      expect(state).toEqual({ account, saved: { account, value: 'saved' }, view: 'saved' });
      await restarted.activate(account);
      expect(restarted.snapshot()).toBe(state);
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
    }
  });

  it('drops the previous view immediately and rejects a delayed response after an account switch', async () => {
    const store = testModule.createStore();
    await store.activate(account);
    await save(store, async () => 'old account');
    const response = delayedResponse();
    const pending = save(store, () => response.promise);
    await clearDatabase();
    const activation = store.activate(anotherAccount);
    expect(store.snapshot()).toEqual({ account: anotherAccount });
    await activation;
    response.finish('late');
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(await readCache('calendar', anotherAccount)).toBeUndefined();
    expect(store.snapshot()).toEqual({ account: anotherAccount });
  });

  it.each(['storage-changed', 'logout'] as const)(
    'clears the store through the account lifecycle on %s',
    async (reason) => {
      const store = testModule.createStore();
      const unregister = testModule.registerStore(store);
      const unregisterDatabase = registerAccountStore({
        name: 'test-database',
        phase: 'before-invalidation',
        clear: ({ removeStored }) => clearDatabase(removeStored),
      });
      try {
        const session = { family: { id: 'family' }, user: { id: 'user' } } as AccountSession;
        await restoreAccountStores(session, undefined, () => true);
        await save(store, async () => 'saved');
        const response = delayedResponse();
        const pending = save(store, () => response.promise);
        const clearing = clearAccountData(reason);
        expect(store.snapshot()).toEqual({ account: '' });
        await clearing;
        response.finish('late');
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(Boolean(await readCache('calendar'))).toBe(reason === 'storage-changed');
      } finally {
        unregister();
        unregisterDatabase();
      }
    },
  );

  it('reads IndexedDB on a storage signal and discards a response that started before the signal', async () => {
    const store = testModule.createStore();
    const unsubscribe = store.subscribe(() => {});
    try {
      await store.activate(account);
      await save(store, async () => 'original');
      const response = delayedResponse();
      const pending = save(store, () => response.promise);
      await writeCache('calendar', { account, value: 'other tab' });
      window.dispatchEvent(new StorageEvent('storage', { key: cacheSignal('tasks') }));
      expect(store.snapshot().view).toBe('original');
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: cacheSignal('calendar'),
          newValue: JSON.stringify({ account: anotherAccount, value: 'untrusted' }),
        }),
      );
      response.finish('late');
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(store.snapshot().view).toBe('other tab');
    } finally {
      unsubscribe();
    }
  });

  it('projects the durable snapshot with ordered outbox changes after a committed write', async () => {
    const wasOnline = onlineManager.isOnline();
    onlineManager.setOnline(false);
    const sync = vi.fn(() => ({ send: vi.fn(), reconcile: vi.fn(), invalidateAccess: vi.fn() }));
    const store = registerOfflineModule({
      mode: 'read-write',
      cache: { ...cache, module: 'tasks' },
      readError,
      readChanges: async (tx, identity) =>
        (await readOperations(tx, identity)).filter((op) => op.module === 'tasks').map((op) => String(op.payload)),
      project: (snapshot: Snapshot | undefined, changes: readonly string[]) => [snapshot?.value, ...changes],
      sync,
    }).createStore();
    try {
      await store.activate(account);
      expect(sync).toHaveBeenCalledWith(account);
      await writeCache('tasks', { account, value: 'base' });
      await transact('readwrite', async (tx) => {
        for (const change of ['first', 'second']) {
          await appendOperation(tx, account, 'tasks', {
            operationId: change,
            submittedAt: Date.now(),
            entityId: 'entity',
            orderingKeys: ['entity'],
            payload: change,
          });
        }
      });
      await vi.waitFor(() => expect(store.snapshot().view).toEqual(['base', 'first', 'second']));
      expect(store.snapshot().saved).toEqual({ account, value: 'base' });
    } finally {
      store.clear();
      onlineManager.setOnline(wasOnline);
    }
  });
});
