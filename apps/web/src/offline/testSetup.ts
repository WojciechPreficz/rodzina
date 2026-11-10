import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, afterEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import { closeDatabase } from './database.js';
import { forgetOfflineData } from '../offlineData.js';
import { reportStorageIssue } from './status.js';

beforeEach(async () => {
  await closeDatabase();
  forgetOfflineData();
  localStorage.clear();
  reportStorageIssue();
  Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: webcrypto.subtle });
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, writable: true, value: new IDBFactory() });
  const queues = new Map<string, Promise<unknown>>();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (
        name: string,
        actionOrOptions: (() => Promise<unknown>) | LockOptions,
        callback?: () => Promise<unknown>,
      ) => {
        const action = typeof actionOrOptions === 'function' ? actionOrOptions : callback!;
        if (name.startsWith('offline-client:')) return action();
        const signal = typeof actionOrOptions === 'function' ? undefined : actionOrOptions.signal;
        return new Promise((resolve, reject) => {
          const abort = () => reject(signal?.reason);
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) abort();
          const turn = (queues.get(name) ?? Promise.resolve()).then(async () => {
            signal?.removeEventListener('abort', abort);
            signal?.throwIfAborted();
            resolve(await action());
          });
          queues.set(name, turn.catch(reject));
        });
      },
      query: async () => ({ held: [], pending: [] }),
    },
  });
});
afterEach(async () => {
  await closeDatabase();
});
