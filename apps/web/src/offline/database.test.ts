import { recoverPreviewData } from './previewRecovery.js';
import { needsLegacyRecovery } from './legacySources.js';
import './testSetup.js';
import { readFileSync } from 'node:fs';
import { IDBObjectStore } from 'fake-indexeddb';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { accountId, hydrateOfflineData, saveOfflineData, readOfflineData, forgetOfflineData } from '../offlineData.js';
import { createCalendarStore } from '../features/calendar/index.js';
import {
  activateOfflineAccount,
  clearDatabase,
  closeDatabase,
  openDatabase,
  readCache,
  recoverPendingClear,
  requestValue,
  transact,
  writeCache,
  PROTOCOL_KEY,
  CLEAR_PENDING_KEY,
} from './database.js';
import { adapters, chargedBytes } from './registry.js';

// Keep other feature migrations unregistered while testing the family and calendar previews.
vi.mock('../features/contacts/index.js', () => ({}));
vi.mock('../features/shopping/index.js', () => ({}));
vi.mock('../features/tasks/index.js', () => ({}));

const fixture = JSON.parse(readFileSync('test-fixtures/offline/legacy-valid.json', 'utf8')) as {
  accountId: string;
  entries: { key: string; value: unknown }[];
};
const family = fixture.entries.find((entry) => entry.key === 'rodzina:offline-data:v1')!.value as {
  account: string;
  session: Parameters<typeof saveOfflineData>[0];
};
const calendar = fixture.entries.find((entry) => entry.key === 'rodzina:calendar:v1')!.value;
function seed() {
  for (const entry of fixture.entries) localStorage.setItem(entry.key, JSON.stringify(entry.value));
}
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('shared IndexedDB previews', () => {
  it('detects legacy sources without starting a recovery', async () => {
    seed();
    expect(await needsLegacyRecovery()).toBe(true);
    expect(await readCache('family')).toBeUndefined();
    expect(localStorage.getItem('rodzina:offline-data:v1')).not.toBeNull();
  });
  it('atomically imports both previews, keeps unmigrated modules, and restores after a cold start', async () => {
    seed();
    const shopping = localStorage.getItem('rodzina:shopping:v1');
    await recoverPreviewData();
    expect(localStorage.getItem('rodzina:offline-data:v1')).toBeNull();
    expect(localStorage.getItem('rodzina:calendar:v1')).toBeNull();
    expect(localStorage.getItem('rodzina:shopping:v1')).toBe(shopping);
    await closeDatabase();
    forgetOfflineData();
    const data = await hydrateOfflineData();
    expect(data?.session.family.joinCode).toBe('TEST-CODE');
    const store = createCalendarStore();
    await store.activate(fixture.accountId);
    expect(store.snapshot().view?.ranges).toHaveLength(1);
    expect(Object.keys(store.snapshot().view?.personal ?? {})).toHaveLength(1);
    expect(await transact('readonly', async (tx) => requestValue(tx.objectStore('migration').count()))).toBe(0);
  });
  it('resumes a staged import after the commit runs out of space and rolls back every target', async () => {
    seed();
    const keys = ['rodzina:offline-data:v1', 'rodzina:calendar:v1'];
    const sources = keys.map((key) => localStorage.getItem(key));
    const put = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      if (this.name === 'migration' && args[0].phase === 'committed')
        throw new DOMException('Brak miejsca', 'QuotaExceededError');
      return put.apply(this, args);
    });
    await expect(recoverPreviewData()).rejects.toThrow('Brak miejsca');
    expect(keys.map((key) => localStorage.getItem(key))).toEqual(sources);
    expect(await transact('readonly', (tx) => requestValue(tx.objectStore('cache').count()))).toBe(0);
    const staged = await transact('readonly', (tx) => requestValue(tx.objectStore('migration').getAll()));
    expect(staged).toMatchObject([{ phase: 'staged' }]);

    spy.mockRestore();
    await closeDatabase();
    await recoverPreviewData();
    expect((await readCache('family'))?.payload).toMatchObject(family);
    expect((await readCache('calendar'))?.payload).toEqual(calendar);
    expect(keys.map((key) => localStorage.getItem(key))).toEqual([null, null]);
    expect(await transact('readonly', (tx) => requestValue(tx.objectStore('migration').count()))).toBe(0);
  });
  it('resumes verified cleanup after process loss without reimporting a partially removed source', async () => {
    seed();
    const remove = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key: string) {
      remove.call(this, key);
      if (key === 'rodzina:calendar:v1') throw new Error('Przerwano sprzątanie');
    });
    await expect(recoverPreviewData()).rejects.toThrow('Przerwano');
    expect(localStorage.getItem('rodzina:offline-data:v1')).toBeNull();
    expect(localStorage.getItem('rodzina:calendar:v1')).toBeNull();
    expect(await needsLegacyRecovery()).toBe(true);
    vi.restoreAllMocks();
    await closeDatabase();
    await recoverPreviewData();
    expect((await hydrateOfflineData())?.members).toHaveLength(1);
    expect(localStorage.getItem(PROTOCOL_KEY)).toBe('active');
    expect(await needsLegacyRecovery()).toBe(false);
  });
  it.each(['corrupt', 'foreign', 'future'])('blocks invalid %s sources without deleting them', async (kind) => {
    seed();
    localStorage.setItem(
      'rodzina:offline-data:v1',
      kind === 'corrupt'
        ? '{bad'
        : JSON.stringify({ ...family, ...(kind === 'foreign' ? { account: 'foreign:user' } : { version: 8 }) }),
    );
    await expect(recoverPreviewData()).rejects.toThrow();
    expect(localStorage.getItem('rodzina:calendar:v1')).not.toBeNull();
    expect(await readCache('family')).toBeUndefined();
  });
  it('detects a legacy writer during preflight and does not commit', async () => {
    seed();
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: async () => {
          localStorage.setItem('rodzina:calendar:v1', '{}');
          return {};
        },
      },
    });
    await expect(recoverPreviewData()).rejects.toThrow('starej karty');
    expect(await readCache('family')).toBeUndefined();
    Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
  });
  it('rejects a previously unknown old writer after the switch', async () => {
    seed();
    await recoverPreviewData();
    localStorage.setItem('rodzina:calendar:v1', JSON.stringify(calendar));
    await expect(recoverPreviewData()).rejects.toThrow('Starsza karta');
    expect(localStorage.getItem('rodzina:calendar:v1')).not.toBeNull();
  });
  it('invalidates a pending write before clearing all stores and never resurrects the session', async () => {
    await saveOfflineData(family.session);
    const pending = saveOfflineData(family.session);
    forgetOfflineData();
    await clearDatabase();
    expect(await pending).toBe(false);
    expect(await hydrateOfflineData()).toBeUndefined();
    expect(readOfflineData()).toBeUndefined();
    expect(localStorage.getItem(CLEAR_PENDING_KEY)).toBeNull();
  });
  it('keeps a durable clear-pending marker when deletion is denied', async () => {
    await saveOfflineData(family.session);
    const clear = vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(() => {
      throw new Error('Odmowa');
    });
    await expect(clearDatabase()).rejects.toThrow('Odmowa');
    expect(localStorage.getItem(CLEAR_PENDING_KEY)).toBe('yes');
    expect(await hydrateOfflineData()).toBeUndefined();
    clear.mockRestore();
    await clearDatabase();
    expect(await hydrateOfflineData()).toBeUndefined();
  });
  it.each(['same', 'different', 'logout'])(
    'recovers a suspended outbox and handles %s account boundary',
    async (boundary) => {
      const owner = fixture.accountId;
      await saveOfflineData(family.session);
      await transact('readwrite', async (tx) => {
        tx.objectStore('outbox').put({ accountId: owner, operationId: 'pending' });
      });
      const clear = vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(() => {
        throw new Error('Odmowa');
      });
      await expect(clearDatabase(true, 'session-lost')).rejects.toThrow('Odmowa');
      expect(localStorage.getItem(CLEAR_PENDING_KEY)).toBe('session-lost');
      clear.mockRestore();
      await closeDatabase();
      await recoverPendingClear();
      await clearDatabase(true, 'session-lost');
      expect(await readCache('family')).toBeUndefined();
      await expect(activateOfflineAccount(owner)).rejects.toThrow('Session changed');
      if (boundary === 'logout') await clearDatabase();
      else {
        await clearDatabase(true, 'sign-in');
        await activateOfflineAccount(boundary === 'same' ? owner : 'other:user', true);
      }
      const count = await transact('readonly', (tx) => requestValue(tx.objectStore('outbox').count()));
      expect(count).toBe(boundary === 'same' ? 1 : 0);
      await clearDatabase();
    },
  );
  it('keeps the last valid copy on budget failure and charges UTF8 data and metadata', async () => {
    await saveOfflineData(family.session);
    const before = await readCache('family');
    expect(before!.chargedBytes).toBeGreaterThan(chargedBytes('test', 'test'));
    const adapter = adapters.get('family')!;
    const original = adapter.budget;
    adapter.budget = before!.chargedBytes - 1;
    try {
      expect(await saveOfflineData(family.session)).toBe(false);
      expect(await readCache('family')).toEqual(before);
    } finally {
      adapter.budget = original;
    }
  });
  it('blocks startup on denied IndexedDB without falling back to legacy writes', async () => {
    const factory = indexedDB;
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: {
        open() {
          throw new DOMException('Odmowa', 'SecurityError');
        },
      },
    });
    try {
      expect(await saveOfflineData(family.session)).toBe(false);
      expect(localStorage.getItem('rodzina:offline-data:v1')).toBeNull();
      await expect(openDatabase()).rejects.toThrow('IndexedDB');
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: factory });
    }
  });
  it('rejects another account and unknown record versions', async () => {
    await saveOfflineData(family.session);
    await expect(activateOfflineAccount('other:user')).rejects.toThrow('Session changed');
    await expect(writeCache('family', { ...family, version: 2 })).rejects.toThrow();
    expect((await readCache('family'))?.accountId).toBe(accountId(family.session));
  });
  it('waits for an explicit frozen ACK from each live protocol client', async () => {
    seed();
    vi.spyOn(navigator.locks, 'query').mockResolvedValue({
      held: [{ name: 'offline-client:1:unresponsive', mode: 'exclusive', clientId: 'test' }],
      pending: [],
    });
    await expect(recoverPreviewData()).rejects.toThrow('Inna karta');
    expect(await readCache('family')).toBeUndefined();
    expect(localStorage.getItem('rodzina:calendar:v1')).not.toBeNull();
  });
  it('rejects an upgrade blocked by another connection and closes a late successful open', async () => {
    const close = vi.fn();
    const request = {} as IDBOpenDBRequest;
    vi.spyOn(indexedDB, 'open').mockReturnValue(request);
    const opening = openDatabase();
    request.onblocked!.call(request, new Event('blocked') as IDBVersionChangeEvent);
    await expect(opening).rejects.toThrow('zablokowana');
    Object.defineProperty(request, 'result', { value: { close } });
    request.onsuccess!.call(request, new Event('success'));
    expect(close).toHaveBeenCalledOnce();
  });
  it('closes an older connection and invalidates its writer on versionchange', async () => {
    await saveOfflineData(family.session);
    await new Promise<void>((resolve, reject) => {
      const upgrade = indexedDB.open('rodzina-offline', 4);
      upgrade.onsuccess = () => {
        upgrade.result.close();
        resolve();
      };
      upgrade.onerror = () => reject(upgrade.error);
    });
    await expect(openDatabase()).rejects.toThrow('IndexedDB');
    expect(await saveOfflineData(family.session)).toBe(false);
  });
  it('invalidates an import paused in preflight when logout starts', async () => {
    seed();
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: async () => {
          entered();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          return {};
        },
      },
    });
    const importing = recoverPreviewData();
    await waiting;
    await clearDatabase();
    release();
    await expect(importing).rejects.toThrow();
    expect(await readCache('family')).toBeUndefined();
    Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
  });
  it('rejects a remote logout boundary even before its storage signal is delivered', async () => {
    seed();
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: {
        estimate: async () => {
          await transact('readwrite', async (tx) => {
            tx.objectStore('metadata').put({ accountId: '__origin__', key: 'boundary', value: 'remote-logout' });
          });
          return {};
        },
      },
    });
    try {
      await expect(recoverPreviewData()).rejects.toThrow('Session changed');
      expect(await readCache('family')).toBeUndefined();
      expect(localStorage.getItem('rodzina:offline-data:v1')).not.toBeNull();
    } finally {
      Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
    }
  });
  it('does not restore a session from an asynchronous read started before logout', async () => {
    await saveOfflineData(family.session);
    forgetOfflineData();
    const reading = hydrateOfflineData();
    await clearDatabase();
    expect(await reading).toBeUndefined();
    expect(readOfflineData()).toBeUndefined();
  });
  it('enforces the real family budget on large Unicode data and preserves completeness', async () => {
    await saveOfflineData(family.session, [], 123);
    const before = await readCache('family');
    expect(before?.coverage).toBe('complete');
    expect(before?.chargedBytes).toBe(chargedBytes([fixture.accountId, 'family', 'snapshot'], before));
    expect(
      await saveOfflineData({ ...family.session, family: { ...family.session.family, name: 'ą'.repeat(600000) } }),
    ).toBe(false);
    expect(await readCache('family')).toEqual(before);
    await saveOfflineData(family.session);
    expect((await readCache('family'))?.coverage).toBe('partial');
  });
});
