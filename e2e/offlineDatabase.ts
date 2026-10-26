import type { Page } from '@playwright/test';

export function readOfflineSnapshot<T>(
  page: Page,
  module: 'family' | 'calendar' | 'shopping' | 'tasks' | 'contacts',
): Promise<T | undefined> {
  return page.evaluate(async (module) => {
    if (!(await indexedDB.databases()).some((database) => database.name === 'rodzina-offline')) return;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('rodzina-offline');
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
  }, module) as Promise<T | undefined>;
}

export async function writeOfflineSnapshot<T>(page: Page, module: 'tasks' | 'contacts', payload: T) {
  await page.evaluate(
    async ({ module, payload }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('rodzina-offline');
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
    { module, payload },
  );
}
