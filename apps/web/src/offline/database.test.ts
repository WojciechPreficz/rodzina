import './testSetup.js';
import { readFileSync } from 'node:fs';
import { IDBObjectStore } from 'fake-indexeddb';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { accountId, hydrateOfflineData, saveOfflineData, readOfflineData, forgetOfflineData } from '../offlineData.js';
import { CalendarOfflineStore } from '../features/calendar/calendarOffline.js';
import {
  activateOfflineAccount,
  clearDatabase,
  closeDatabase,
  ensureMigrated,
  openDatabase,
  readCache,
  requestValue,
  transact,
  writeCache,
  PROTOCOL_KEY,
  CLEAR_PENDING_KEY,
} from './database.js';
import { adapters, chargedBytes } from './registry.js';

const fixture = JSON.parse(readFileSync('docs/offline/fixtures/legacy-valid.json', 'utf8')) as {
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
  it('requires the maintenance confirmation even if a legacy tab is silent', async () => {
    seed();
    await expect(ensureMigrated()).rejects.toThrow('Zamknij starsze karty');
    expect(await readCache('family')).toBeUndefined();
    expect(localStorage.getItem('rodzina:offline-data:v1')).not.toBeNull();
  });
  it('atomically imports both previews, keeps unmigrated modules, and restores after a cold start', async () => {
    seed();
    const shopping = localStorage.getItem('rodzina:shopping:v1');
    await ensureMigrated(true);
    expect(localStorage.getItem('rodzina:offline-data:v1')).toBeNull();
    expect(localStorage.getItem('rodzina:calendar:v1')).toBeNull();
    expect(localStorage.getItem('rodzina:shopping:v1')).toBe(shopping);
    await closeDatabase();
    forgetOfflineData();
    const data = await hydrateOfflineData();
    expect(data?.session.family.joinCode).toBe('TEST-CODE');
    const store = new CalendarOfflineStore();
    await store.activate(fixture.accountId);
    expect(store.snapshot().ranges).toHaveLength(1);
    expect(Object.keys(store.snapshot().personal)).toHaveLength(1);
    expect(await transact('readonly', async (tx) => requestValue(tx.objectStore('migration').count()))).toBe(0);
  });
  it('retains both sources and rolls back every target when a transaction runs out of space', async () => {
    seed();
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      if (this.name === 'migration') throw new DOMException('Brak miejsca', 'QuotaExceededError');
      return put.apply(this, args);
    });
    await expect(ensureMigrated(true)).rejects.toThrow('Brak miejsca');
    expect(localStorage.getItem('rodzina:calendar:v1')).not.toBeNull();
    expect(await readCache('family')).toBeUndefined();
    vi.restoreAllMocks();
    await ensureMigrated();
    expect((await readCache('family'))?.accountId).toBe(fixture.accountId);
  });
  it('resumes verified cleanup after process loss without reimporting a partially removed source', async () => {
    seed();
    const remove = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key: string) {
      if (key === 'rodzina:calendar:v1') throw new Error('Przerwano sprzątanie');
      remove.call(this, key);
    });
    await expect(ensureMigrated(true)).rejects.toThrow('Przerwano');
    expect(localStorage.getItem('rodzina:offline-data:v1')).toBeNull();
    vi.restoreAllMocks();
    await closeDatabase();
    await ensureMigrated();
    expect((await hydrateOfflineData())?.members).toHaveLength(1);
    expect(localStorage.getItem(PROTOCOL_KEY)).toBe('active');
  });
  it.each(['corrupt', 'foreign', 'future'])('blocks invalid %s sources without deleting them', async (kind) => {
    seed();
    localStorage.setItem(
      'rodzina:offline-data:v1',
      kind === 'corrupt'
        ? '{bad'
        : JSON.stringify({ ...family, ...(kind === 'foreign' ? { account: 'foreign:user' } : { version: 8 }) }),
    );
    await expect(ensureMigrated(true)).rejects.toThrow();
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
    await expect(ensureMigrated(true)).rejects.toThrow('starej karty');
    expect(await readCache('family')).toBeUndefined();
    Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
  });
  it('rejects a previously unknown old writer after the switch', async () => {
    seed();
    await ensureMigrated(true);
    localStorage.setItem('rodzina:calendar:v1', JSON.stringify(calendar));
    await expect(ensureMigrated(true)).rejects.toThrow('Starsza karta');
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
    await expect(ensureMigrated(true)).rejects.toThrow('Inna karta');
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
      const upgrade = indexedDB.open('rodzina-offline', 3);
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
    const importing = ensureMigrated(true);
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
      await expect(ensureMigrated(true)).rejects.toThrow('Session changed');
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
