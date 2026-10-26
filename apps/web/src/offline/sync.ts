import { focusManager, onlineManager } from '@tanstack/react-query';
import { assertOfflineReplayAge, OfflineOperationExpiredError } from '@rodzina/shared';
import { ApiRequestError } from '../api.js';
import { accountToken, isAccountCurrent, transact, requestValue } from './database.js';
import {
  acquireLease,
  assertLease,
  completeOperation,
  nextOperation,
  readOperations,
  type Operation,
  type Lease,
} from './outbox.js';
import { publishSyncStatus, reportStorageIssue, storageError } from './status.js';

export type SyncAdapter = {
  module: string;
  prepare: (operation: Operation, signal: AbortSignal) => Promise<void>;
  send: (operation: Operation, signal: AbortSignal) => Promise<unknown>;
  reconcile: (tx: IDBTransaction, operation: Operation, response: unknown) => Promise<void>;
  invalidateAccess: (tx: IDBTransaction, operation: Operation, error: ApiRequestError) => Promise<void>;
};
export function retryAt(attempts: number, retryAfterMs = 0, now = Date.now(), random = Math.random()) {
  return now + Math.max(retryAfterMs, random * Math.min(300000, 3000 * 2 ** Math.min(attempts, 20)));
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Sender stopped', 'AbortError'));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
export function startSync(accountId: string, adapters: SyncAdapter[], changed: () => Promise<void> | void) {
  const token = accountToken();
  const owner = crypto.randomUUID();
  let active = true;
  let running: Promise<void> | undefined;
  let controller: AbortController | undefined;
  let lease: Lease | undefined;
  let revision = '';
  let sessionConfirmed = false;
  const current = () => active && isAccountCurrent(token);
  const transaction = <T>(action: (tx: IDBTransaction) => Promise<T>) => transact('readwrite', action, token);
  const status = async () => {
    if (!current()) return;
    const { operations, synced } = await transact(
      'readonly',
      async (tx) => ({
        operations: await readOperations(tx, accountId),
        synced: await requestValue<{ key: string; value: number }[]>(
          tx.objectStore('metadata').index('accountId').getAll(accountId),
        ),
      }),
      token,
    );
    if (!current()) return;
    const nextRevision = JSON.stringify([
      operations,
      synced.filter((entry) => entry.key.startsWith('last-sync:')),
      sessionConfirmed,
      adapters.map((adapter) => adapter.module),
    ]);
    if (nextRevision === revision) return;
    await changed();
    if (!current()) return;
    revision = nextRevision;
    for (const adapter of adapters) {
      const own = operations.filter((op) => op.module === adapter.module);
      publishSyncStatus(accountId, adapter.module, {
        pendingCount: own.filter((op) => op.status !== 'needs-review').length,
        reviewCount: own.filter((op) => op.status === 'needs-review').length,
        syncing: own.some((op) => op.status === 'sending'),
        lastError: own.find((op) => op.lastError)?.lastError,
        lastSyncedAt: synced.find((entry) => entry.key === `last-sync:${adapter.module}`)?.value ?? null,
        sessionConfirmed,
      });
    }
  };
  const run = async () => {
    if (!current()) return;
    try {
      await status();
      while (current() && onlineManager.isOnline()) {
        const operation = await transaction(async (tx) => {
          lease = await acquireLease(tx, accountId, owner, Date.now());
          if (!lease) return;
          const operations = await readOperations(tx, accountId);
          // Expiration is durable, even if the clock subsequently moves backwards.
          for (const op of operations) {
            if (op.status === 'needs-review') continue;
            try {
              assertOfflineReplayAge(op.submittedAt);
            } catch {
              op.status = 'needs-review';
              op.reviewReason = 'expired';
              op.lastError = 'Zmiana ma ponad 30 dni i wymaga sprawdzenia.';
              tx.objectStore('outbox').put(op);
            }
          }
          const blockedIds = new Set<string>();
          const blockedKeys = new Set<string>();
          for (const op of operations) {
            if (
              op.status !== 'needs-review' &&
              (op.dependsOn.some((id) => blockedIds.has(id)) || op.orderingKeys.some((key) => blockedKeys.has(key)))
            ) {
              op.status = 'needs-review';
              op.reviewReason = 'dependency';
              op.lastError = 'Zmiana zależy od wcześniejszej zmiany wymagającej sprawdzenia.';
              tx.objectStore('outbox').put(op);
            }
            if (op.status === 'needs-review') {
              blockedIds.add(op.operationId);
              op.orderingKeys.forEach((key) => blockedKeys.add(key));
            }
          }
          const op = nextOperation(operations, Date.now(), (op) =>
            adapters.some((adapter) => adapter.module === op.module),
          );
          if (!op || !adapters.some((adapter) => adapter.module === op.module)) {
            tx.objectStore('metadata').put({ accountId, key: 'sender-lease', value: { ...lease, expiresAt: 0 } });
            return;
          }
          op.status = 'sending';
          tx.objectStore('outbox').put(op);
          return op;
        });
        await status();
        if (!operation || !current()) break;
        const adapter = adapters.find((adapter) => adapter.module === operation.module);
        if (!adapter) continue;
        const captured = lease!;
        const request = new AbortController();
        controller = request;
        const renewal = window.setInterval(() => {
          void transaction(async (tx) => {
            const old = await assertLease(tx, accountId, captured, Date.now());
            tx.objectStore('metadata').put({
              accountId,
              key: 'sender-lease',
              value: { ...old, expiresAt: Date.now() + 15000 },
            });
          }).catch(() => request.abort());
        }, 5000);
        const timeout = window.setTimeout(() => request.abort(), 60000);
        try {
          await abortable(adapter.prepare(operation, request.signal), request.signal);
          sessionConfirmed = true;
          if (!current()) break;
          await transaction((tx) => assertLease(tx, accountId, captured, Date.now()));
          assertOfflineReplayAge(operation.submittedAt);
          const response = await abortable(adapter.send(operation, request.signal), request.signal);
          if (!current()) break;
          await transaction(async (tx) => {
            await assertLease(tx, accountId, captured, Date.now());
            const operations = await readOperations(tx, accountId);
            if (!operations.some((op) => op.operationId === operation.operationId)) return;
            await adapter.reconcile(tx, operation, response);
            completeOperation(tx, operations, operation);
            tx.objectStore('metadata').put({ accountId, key: `last-sync:${operation.module}`, value: Date.now() });
          });
        } catch (error) {
          if (!current()) break;
          if (error instanceof ApiRequestError && (error.status === 401 || error.code === 'SESSION_CHANGED')) {
            stop();
            window.dispatchEvent(new Event('rodzina:session-lost'));
            break;
          }
          await transaction(async (tx) => {
            await assertLease(tx, accountId, captured, Date.now());
            let old = (await readOperations(tx, accountId)).find((op) => op.operationId === operation.operationId);
            if (!old) return;
            const expired = error instanceof OfflineOperationExpiredError;
            const review = expired || (error instanceof ApiRequestError && error.status < 500 && error.status !== 429);
            if (error instanceof ApiRequestError && [403, 404].includes(error.status)) {
              await adapter.invalidateAccess(tx, old, error);
              old = (await readOperations(tx, accountId)).find((op) => op.operationId === operation.operationId);
              if (!old) return;
            }
            tx.objectStore('outbox').put({
              ...old,
              status: review ? 'needs-review' : 'retry-wait',
              attempts: old.attempts + 1,
              nextAttemptAt: review
                ? 0
                : retryAt(old.attempts, error instanceof ApiRequestError ? error.retryAfterMs : 0),
              lastError: review ? storageError(error) : 'Oczekiwanie na ponowienie synchronizacji.',
              ...(review
                ? {
                    reviewReason: expired
                      ? 'expired'
                      : error instanceof ApiRequestError && error.status === 409
                        ? 'conflict'
                        : 'rejected',
                  }
                : {}),
            });
          });
        } finally {
          window.clearInterval(renewal);
          window.clearTimeout(timeout);
          controller = undefined;
        }
        await status();
      }
    } catch (error) {
      if (current() && !(error instanceof DOMException && error.name === 'AbortError'))
        reportStorageIssue(`Nie można zsynchronizować zmian. ${storageError(error)}`);
    } finally {
      if (current()) await status().catch(() => {});
    }
  };
  const synchronize = () => {
    running ??= run().finally(() => {
      running = undefined;
    });
    return running;
  };
  const wake = () => {
    if (!current()) {
      stop();
      return;
    }
    void synchronize();
  };
  const stopOnline = onlineManager.subscribe(wake);
  const stopFocus = focusManager.subscribe(wake);
  const onStorage = () => wake();
  window.addEventListener('storage', onStorage);
  window.addEventListener('offline-account-changed', stop);
  window.addEventListener('offline-context-invalidated', stop);
  window.addEventListener('rodzina:session-lost', stop);
  window.addEventListener('pagehide', stop);
  const timer = window.setInterval(wake, 500);
  function stop() {
    if (!active) return;
    active = false;
    controller?.abort();
    window.clearInterval(timer);
    stopOnline();
    stopFocus();
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('offline-account-changed', stop);
    window.removeEventListener('offline-context-invalidated', stop);
    window.removeEventListener('rodzina:session-lost', stop);
    window.removeEventListener('pagehide', stop);
    for (const adapter of adapters) publishSyncStatus(accountId, adapter.module);
    void transaction(async (tx) => {
      if (!lease) return;
      const old = await assertLease(tx, accountId, lease, Date.now());
      tx.objectStore('metadata').put({ accountId, key: 'sender-lease', value: { ...old, expiresAt: 0 } });
    }).catch(() => {});
  }
  wake();
  return { wake, stop, refreshStatus: status, synchronize, isActive: current };
}

// All mounted modules share one account sender and one set of lifecycle listeners.
const accountSenders = new Map<
  string,
  {
    adapters: SyncAdapter[];
    listeners: Map<() => Promise<void> | void, SyncAdapter>;
    sender: ReturnType<typeof startSync>;
  }
>();
export function joinSync(accountId: string, adapter: SyncAdapter, changed: () => Promise<void> | void) {
  let entry = accountSenders.get(accountId);
  if (entry && !entry.sender.isActive()) {
    entry.sender.stop();
    accountSenders.delete(accountId);
    entry = undefined;
  }
  if (!entry) {
    const adapters: SyncAdapter[] = [];
    const listeners = new Map<() => Promise<void> | void, SyncAdapter>();
    entry = {
      adapters,
      listeners,
      sender: startSync(accountId, adapters, async () => {
        for (const listener of listeners.keys()) await listener();
      }),
    };
    accountSenders.set(accountId, entry);
  }
  const joined = entry;
  // Multiple views may observe a module, but there is only one transport for it.
  if (!joined.adapters.some((value) => value.module === adapter.module)) joined.adapters.push(adapter);
  joined.listeners.set(changed, adapter);
  joined.sender.wake();
  return {
    ...joined.sender,
    stop: () => {
      joined.listeners.delete(changed);
      joined.adapters.splice(0, joined.adapters.length);
      for (const value of joined.listeners.values())
        if (!joined.adapters.some((adapter) => adapter.module === value.module)) joined.adapters.push(value);
      if (!joined.adapters.some((value) => value.module === adapter.module))
        publishSyncStatus(accountId, adapter.module);
      if (!joined.listeners.size) {
        joined.sender.stop();
        if (accountSenders.get(accountId) === joined) accountSenders.delete(accountId);
      }
    },
  };
}
