import type { Page } from '@playwright/test';

export function readOfflineSnapshot<T>(
  page: Page,
  module: 'family' | 'calendar' | 'shopping' | 'tasks' | 'contacts',
): Promise<T | undefined> {
  return page.evaluate(async (module) => {
    if (!(await indexedDB.databases()).some((database) => database.name === 'rodzina-offline')) return;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('rodzina-offline', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!db.objectStoreNames.contains('cache')) return;
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('cache');
        const request = transaction.objectStore('cache').getAll();
        request.onsuccess = () =>
          resolve(request.result.find((entry: { module: string }) => entry.module === module)?.payload);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, module) as Promise<T | undefined>;
}

export async function writeOfflineSnapshot<T>(page: Page, module: 'tasks' | 'contacts', payload: T) {
  await page.evaluate(
    async ({ module, payload }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('rodzina-offline', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('cache', 'readwrite');
          const store = tx.objectStore('cache');
          const request = store.getAll();
          request.onsuccess = () => {
            const record = request.result.find((entry: { module: string }) => entry.module === module);
            if (!record) {
              tx.abort();
              return;
            }
            store.put({ ...record, payload });
          };
          tx.oncomplete = () => resolve();
          tx.onabort = tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
      window.dispatchEvent(new StorageEvent('storage', { key: `offline-${module}-changed:1` }));
    },
    { module, payload },
  );
}
