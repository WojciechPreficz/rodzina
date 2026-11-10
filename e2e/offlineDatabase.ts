import type { Page } from '@playwright/test';

export function offlineDatabaseName(page: Page) {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some((db) => db.name === 'rodzina-offline' && (db.version ?? 0) >= 5)) return;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('rodzina-offline');
      open.onupgradeneeded = () => open.transaction!.abort();
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      return await new Promise<string | undefined>((resolve, reject) => {
        const request = db.transaction('routing').objectStore('routing').get('account');
        request.onsuccess = () =>
          resolve(request.result?.accountId ? `rodzina-${request.result.accountId}` : undefined);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}

export async function readOfflineSnapshot<T>(
  page: Page,
  module: 'family' | 'calendar' | 'shopping' | 'tasks' | 'contacts',
): Promise<T | undefined> {
  const name = await offlineDatabaseName(page);
  if (!name) return;
  return page.evaluate(
    async ({ module, name }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onupgradeneeded = () => request.transaction!.abort();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        if (!db.objectStoreNames.contains('cache')) return;
        return await new Promise((resolve, reject) => {
          const transaction = db.transaction(['cache', 'outbox']);
          const request = transaction.objectStore('cache').getAll();
          request.onsuccess = () => {
            const record = request.result.find((entry: { module: string }) => entry.module === module);
            if (!['shopping', 'tasks'].includes(module) || !record) return resolve(record?.payload);
            const pending = transaction.objectStore('outbox').index('accountId').getAll(record.accountId);
            pending.onsuccess = () =>
              resolve({
                ...record.payload,
                operations: pending.result
                  .filter((op: { module: string }) => op.module === module)
                  .map((op) =>
                    module === 'tasks'
                      ? {
                          ...op.payload,
                          id: op.operationId,
                          submittedAt: op.submittedAt,
                          status: op.status === 'needs-review' ? 'needs-review' : 'pending',
                          reason: op.reviewReason,
                        }
                      : op,
                  ),
              });
            pending.onerror = () => reject(pending.error);
          };
          request.onerror = () => reject(request.error);
        });
      } finally {
        db.close();
      }
    },
    { module, name },
  ) as Promise<T | undefined>;
}

export async function writeOfflineSnapshot<T>(page: Page, module: 'tasks' | 'contacts', payload: T) {
  const name = await offlineDatabaseName(page);
  if (!name) throw new Error('No offline account database');
  await page.evaluate(
    async ({ module, payload, name }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onupgradeneeded = () => request.transaction!.abort();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(['cache', 'outbox', 'metadata'], 'readwrite');
          const store = tx.objectStore('cache');
          const request = store.getAll();
          request.onsuccess = () => {
            const record = request.result.find((entry: { module: string }) => entry.module === module);
            if (!record) {
              tx.abort();
              return;
            }
            if (module === 'tasks') {
              const data = payload as {
                operations: {
                  id: string;
                  submittedAt: number;
                  listId: string;
                  taskId: string;
                  change: unknown;
                  status?: string;
                  reason?: string;
                }[];
              };
              const outbox = tx.objectStore('outbox');
              const pending = outbox.index('accountId').getAll(record.accountId);
              pending.onsuccess = () => {
                for (const op of pending.result)
                  if (op.module === 'tasks') outbox.delete([record.accountId, op.operationId]);
                let sequence = Math.max(0, ...pending.result.map((op) => op.sequence));
                const previous = new Map<string, string>();
                for (const op of data.operations) {
                  const key = `tasks:list:${op.listId}:task:${op.taskId}`;
                  outbox.put({
                    schemaVersion: 1,
                    payloadVersion: 1,
                    module: 'tasks',
                    accountId: record.accountId,
                    operationId: op.id,
                    submittedAt: op.submittedAt,
                    entityId: op.taskId,
                    sequence: ++sequence,
                    orderingKeys: [key],
                    dependsOn: previous.has(key) ? [previous.get(key)] : [],
                    payload: { listId: op.listId, taskId: op.taskId, change: op.change },
                    status: op.status ?? 'pending',
                    reviewReason: op.reason,
                    attempts: 0,
                    nextAttemptAt: 0,
                  });
                  previous.set(key, op.id);
                }
                tx.objectStore('metadata').put({
                  accountId: record.accountId,
                  key: 'outbox-sequence',
                  value: sequence,
                });
              };
              store.put({ ...record, payload: { ...data, operations: [] } });
            } else store.put({ ...record, payload });
          };
          tx.oncomplete = () => resolve();
          tx.onabort = tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
      window.dispatchEvent(new StorageEvent('storage', { key: `offline-${module}-changed:1` }));
    },
    { module, payload, name },
  );
}
