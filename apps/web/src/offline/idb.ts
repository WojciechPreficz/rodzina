export const stores = ['cache', 'outbox', 'metadata', 'migration'] as const;
export const changed = () => new DOMException('Session changed', 'AbortError');
export class StorageBlockedError extends Error {}

export function createAccountStores(db: IDBDatabase) {
  const cache = db.createObjectStore('cache', { keyPath: ['accountId', 'module', 'key'] });
  cache.createIndex('accountId', 'accountId');
  cache.createIndex('module', ['accountId', 'module']);
  cache.createIndex('usedAt', ['accountId', 'module', 'usedAt']);
  const outbox = db.createObjectStore('outbox', { keyPath: ['accountId', 'operationId'] });
  outbox.createIndex('accountId', 'accountId');
  outbox.createIndex('sequence', ['accountId', 'sequence'], { unique: true });
  outbox.createIndex('module', ['accountId', 'module']);
  outbox.createIndex('retry', ['accountId', 'status', 'nextAttemptAt']);
  const metadata = db.createObjectStore('metadata', { keyPath: ['accountId', 'key'] });
  metadata.createIndex('accountId', 'accountId');
  const migration = db.createObjectStore('migration', { keyPath: ['accountId', 'module', 'importId'] });
  migration.createIndex('accountId', 'accountId');
  migration.createIndex('module', ['accountId', 'module']);
}

export function open(name: string, version: number, upgrade: (db: IDBDatabase) => void) {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(name, version);
    } catch {
      reject(new Error('Pamięć IndexedDB jest niedostępna. Włącz dostęp do pamięci urządzenia.'));
      return;
    }
    let blocked = false;
    request.onupgradeneeded = () => {
      if (blocked) request.transaction!.abort();
      else upgrade(request.result);
    };
    request.onblocked = () => {
      blocked = true;
      reject(
        new StorageBlockedError(
          'Aktualizacja pamięci jest zablokowana. Zamknij pozostałe karty aplikacji i ponów próbę.',
        ),
      );
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
  });
}

export function deleteAccountDatabase(name: string) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(
        new StorageBlockedError('Usuwanie pamięci jest zablokowane. Zamknij pozostałe karty aplikacji i ponów próbę.'),
      );
  });
}

export const requestValue = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export function abort(transaction: IDBTransaction) {
  try {
    transaction.abort();
  } catch {
    /* A completed transaction cannot be aborted. */
  }
}

export async function runTransaction<T>(transaction: IDBTransaction, action: (tx: IDBTransaction) => Promise<T>) {
  const completion = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? changed());
  });
  try {
    const [result] = await Promise.all([action(transaction), completion]);
    return result;
  } catch (error) {
    abort(transaction);
    await completion.catch(() => {});
    throw error;
  }
}
