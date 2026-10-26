import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, afterEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import { closeDatabase } from './database.js';
import { forgetOfflineData } from '../offlineData.js';
import { reportStorageIssue, requireMigration } from './status.js';

beforeEach(async () => {
  await closeDatabase();
  forgetOfflineData();
  localStorage.clear();
  reportStorageIssue();
  requireMigration(false);
  Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: webcrypto.subtle });
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, writable: true, value: new IDBFactory() });
  let queue = Promise.resolve<unknown>(undefined);
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_name: string, action: () => Promise<unknown>) => {
        if (_name.startsWith('offline-client:')) return action();
        const result = queue.then(action);
        queue = result.catch(() => {});
        return result;
      },
      query: async () => ({ held: [], pending: [] }),
    },
  });
});
afterEach(async () => {
  await closeDatabase();
});
