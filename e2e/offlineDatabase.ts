import type { Page } from '@playwright/test';

export function readOfflineSnapshot<T>(page: Page, module: 'family' | 'calendar' | 'shopping'): Promise<T | undefined> {
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
