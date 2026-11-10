import { focusManager, onlineManager } from '@tanstack/react-query';
import { assertOfflineReplayAge, OfflineOperationExpiredError, OFFLINE_REPLAY_MAX_AGE_MS } from '@rodzina/shared';
import { ApiRequestError } from '../api.js';
import { getSessionGeneration, isAndroid } from '../platform.js';
import type { AccountSession } from '../session.js';
import { accountToken, assertContext, isAccountCurrent, transact, requestValue } from './database.js';
import { completeOperation, recountOutboxBudgets, nextOperation, readOperations, type Operation } from './outbox.js';
import { publishSyncStatus, reportStorageIssue, storageError } from './status.js';
import { offlineTransaction, type OfflineTransaction } from './transaction.js';
import { watchOutbox } from './signals.js';

export type SyncRun = { session?: AccountSession };

export type SyncAdapter = {
  module: string;
  sessionTransport?: (path: string, init?: RequestInit) => Promise<AccountSession>;
  prepare?: (operation: Operation, signal: AbortSignal, run: SyncRun) => Promise<void>;
  send: (operation: Operation, signal: AbortSignal, run?: SyncRun) => Promise<unknown>;
  reconcile: (tx: OfflineTransaction, operation: Operation, response: unknown) => Promise<void>;
  invalidateAccess: (tx: OfflineTransaction, operation: Operation, error: ApiRequestError) => Promise<void>;
};
export function retryAt(attempts: number, retryAfterMs = 0, now = Date.now(), random = Math.random()) {
  return now + Math.max(retryAfterMs, random * Math.min(300000, 3000 * 2 ** Math.min(attempts, 20)));
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Sender stopped', 'AbortError'));
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}
// Android has one application WebView. A replacement sender waits for the previous
// native transport and its reconciliation to settle before using the bridge.
let androidSender = Promise.resolve();
function withSenderLock(accountId: string, android: boolean, signal: AbortSignal, work: () => Promise<void>) {
  if (android) {
    const turn = androidSender.then(async () => {
      if (!signal.aborted) await work();
    });
    androidSender = turn.catch(() => {});
    return abortable(turn, signal);
  }
  const locks = navigator.locks;
  if (!locks) throw new Error('Przeglądarka nie obsługuje bezpiecznej synchronizacji offline.');
  return locks.request(`sync:${accountId}`, { mode: 'exclusive', signal }, work);
}

export function startSync(accountId: string, adapters: SyncAdapter[], changed: () => Promise<void> | void) {
  const token = accountToken();
  const android = isAndroid();
  let active = true;
  let running: Promise<void> | undefined;
  let waiting: AbortController | undefined;
  let controller: AbortController | undefined;
  let hidden = false;
  let revision = '';
  let preparation: SyncRun | undefined;
  let networkRevision = 0;
  let timer: number | undefined;
  let requested = false;
  const current = () => active && isAccountCurrent(token);
  const assertRunning = () => {
    if (!current() || hidden) throw new DOMException('Sender context changed', 'AbortError');
  };
  const transaction = <T>(mode: IDBTransactionMode, action: (tx: IDBTransaction) => Promise<T>) =>
    transact(
      mode,
      async (tx) => {
        if ((await assertContext(tx)).accountId !== accountId)
          throw new DOMException('Sender account changed', 'AbortError');
        assertRunning();
        const result = await action(tx);
        assertRunning();
        return result;
      },
      token,
    );
  const available = (op: Operation) => adapters.some((adapter) => adapter.module === op.module);
  const inspect = () => transaction('readonly', (tx) => readOperations(tx, accountId));
  const schedule = async () => {
    window.clearTimeout(timer);
    timer = undefined;
    if (!current() || hidden || !onlineManager.isOnline()) return;
    const operations = await inspect();
    if (!current()) return;
    const now = Date.now();
    const due = operations.flatMap((op, index) => {
      if (op.status === 'needs-review') return [];
      const times = [op.submittedAt + OFFLINE_REPLAY_MAX_AGE_MS + 1];
      if (
        available(op) &&
        !op.dependsOn.length &&
        !operations.slice(0, index).some((parent) => parent.orderingKeys.some((key) => op.orderingKeys.includes(key)))
      )
        times.push(op.nextAttemptAt);
      return times;
    });
    if (due.length) timer = window.setTimeout(wake, Math.min(2147483647, Math.max(1, Math.min(...due) - now)));
  };
  const status = async () => {
    if (!current() || hidden) return;
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
    const sessionConfirmed = !!preparation?.session;
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
  const runLocked = async () => {
    const network = networkRevision;
    const online = () => !hidden && network === networkRevision && onlineManager.isOnline();
    let generation = getSessionGeneration();
    try {
      while (current() && online()) {
        const operation = await transaction('readwrite', async (tx) => {
          if (!online()) return;
          const operations = await readOperations(tx, accountId);
          if (!online() || !current()) return;
          let classified = false;
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
              classified = true;
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
              classified = true;
            }
            if (op.status === 'needs-review') {
              blockedIds.add(op.operationId);
              op.orderingKeys.forEach((key) => blockedKeys.add(key));
            }
          }
          if (classified) await recountOutboxBudgets(tx, accountId);
          const op = nextOperation(operations, Date.now(), available);
          if (!op) return;
          op.status = 'sending';
          tx.objectStore('outbox').put(op);
          await recountOutboxBudgets(tx, accountId);
          return op;
        });
        await status();
        if (!operation || !current() || !online()) break;
        const adapter = adapters.find((adapter) => adapter.module === operation.module);
        if (!adapter) continue;
        if (generation !== getSessionGeneration()) {
          preparation = undefined;
          generation = getSessionGeneration();
        }
        const context = (preparation ??= {});
        const request = new AbortController();
        controller = request;
        const assertRequestCurrent = () => {
          request.signal.throwIfAborted();
          if (!online() || generation !== getSessionGeneration())
            throw new DOMException('Sender context changed', 'AbortError');
        };
        const transport = <T>(result: Promise<T>) => (android ? result : abortable(result, request.signal));
        const timeout = window.setTimeout(() => request.abort(), 60000);
        let confirmingSession = false;
        try {
          assertRequestCurrent();
          if (adapter.sessionTransport && !context.session) {
            confirmingSession = true;
            const session = await transport(adapter.sessionTransport('/api/auth/me', { signal: request.signal }));
            assertRequestCurrent();
            if (`${session.family.id}:${session.user.id}` !== accountId)
              throw new ApiRequestError('Sesja konta uległa zmianie.', 401, 'SESSION_CHANGED');
            context.session = session;
            confirmingSession = false;
          }
          if (adapter.prepare) await transport(adapter.prepare(operation, request.signal, context));
          if (!current()) break;
          await transaction('readonly', async () => {});
          assertRequestCurrent();
          assertOfflineReplayAge(operation.submittedAt);
          const response = await transport(adapter.send(operation, request.signal, context));
          if (!current()) break;
          assertRequestCurrent();
          await transaction('readwrite', async (tx) => {
            const operations = await readOperations(tx, accountId);
            if (!operations.some((op) => op.operationId === operation.operationId)) return;
            assertRequestCurrent();
            await adapter.reconcile(offlineTransaction(tx, accountId), operation, response);
            assertRequestCurrent();
            completeOperation(tx, await readOperations(tx, accountId), operation);
            await recountOutboxBudgets(tx, accountId);
            tx.objectStore('metadata').put({ accountId, key: `last-sync:${operation.module}`, value: Date.now() });
          });
        } catch (error) {
          if (!(error instanceof ApiRequestError)) preparation = undefined;
          else if (error.status === 403) delete context.session;
          if (!current() || hidden) break;
          if (error instanceof ApiRequestError && (error.status === 401 || error.code === 'SESSION_CHANGED')) {
            stop();
            window.dispatchEvent(new Event('rodzina:session-lost'));
            break;
          }
          await transaction('readwrite', async (tx) => {
            let old = (await readOperations(tx, accountId)).find((op) => op.operationId === operation.operationId);
            if (!old) return;
            const expired = error instanceof OfflineOperationExpiredError;
            const review =
              expired ||
              (!confirmingSession && error instanceof ApiRequestError && error.status < 500 && error.status !== 429);
            if (!confirmingSession && error instanceof ApiRequestError && [403, 404].includes(error.status)) {
              await adapter.invalidateAccess(offlineTransaction(tx, accountId), old, error);
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
                      : error instanceof ApiRequestError && error.code === 'MEAL_EXPORT_CONFIRMATION_REQUIRED'
                        ? 'MEAL_EXPORT_CONFIRMATION_REQUIRED'
                        : error instanceof ApiRequestError && error.status === 409
                          ? 'conflict'
                          : 'rejected',
                  }
                : {}),
            });
            await recountOutboxBudgets(tx, accountId);
          });
        } finally {
          window.clearTimeout(timeout);
          controller = undefined;
        }
        await status();
      }
    } finally {
      preparation = undefined;
    }
  };
  const run = async () => {
    if (!current() || hidden) return;
    try {
      await status();
      if (!current() || hidden || !onlineManager.isOnline()) return;
      const operations = await inspect();
      const now = Date.now();
      const reviewParents = operations.filter((op) => op.status === 'needs-review');
      const needsClassification = operations.some(
        (op) =>
          op.status !== 'needs-review' &&
          (now - op.submittedAt > OFFLINE_REPLAY_MAX_AGE_MS ||
            reviewParents.some(
              (parent) =>
                op.dependsOn.includes(parent.operationId) ||
                (parent.sequence < op.sequence && parent.orderingKeys.some((key) => op.orderingKeys.includes(key))),
            )),
      );
      if (
        current() &&
        !hidden &&
        onlineManager.isOnline() &&
        (needsClassification || nextOperation(operations, now, available))
      ) {
        const pending = new AbortController();
        waiting = pending;
        await withSenderLock(accountId, android, pending.signal, async () => {
          waiting = undefined;
          if (!pending.signal.aborted && current() && !hidden) await runLocked();
        });
      }
      await status();
      await schedule();
    } catch (error) {
      if (current() && !(error instanceof DOMException && error.name === 'AbortError'))
        reportStorageIssue(`Nie można zsynchronizować zmian. ${storageError(error)}`);
    } finally {
      waiting = undefined;
    }
  };
  const synchronize = () => {
    requested = true;
    window.clearTimeout(timer);
    running ??= (async () => {
      do {
        requested = false;
        await run();
      } while (requested && current());
    })().finally(() => {
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
  const interrupt = () => {
    networkRevision++;
    preparation = undefined;
    waiting?.abort();
    controller?.abort();
  };
  const stopOnline = onlineManager.subscribe((isOnline) => {
    if (!isOnline) interrupt();
    wake();
  });
  const stopFocus = focusManager.subscribe((focused) => {
    if (focused) wake();
  });
  const stopSignals = watchOutbox(accountId, wake);
  window.addEventListener('offline-account-changed', stop);
  window.addEventListener('offline-context-invalidated', stop);
  window.addEventListener('rodzina:session-lost', stop);
  const pageHide = (event: PageTransitionEvent) => {
    if (!event.persisted) return stop();
    hidden = true;
    interrupt();
    window.clearTimeout(timer);
  };
  const pageShow = () => {
    if (!hidden) return;
    hidden = false;
    wake();
  };
  window.addEventListener('pagehide', pageHide);
  window.addEventListener('pageshow', pageShow);
  window.addEventListener('focus', wake);
  function stop() {
    if (!active) return;
    active = false;
    interrupt();
    window.clearTimeout(timer);
    stopOnline();
    stopFocus();
    stopSignals();
    window.removeEventListener('offline-account-changed', stop);
    window.removeEventListener('offline-context-invalidated', stop);
    window.removeEventListener('rodzina:session-lost', stop);
    window.removeEventListener('pagehide', pageHide);
    window.removeEventListener('pageshow', pageShow);
    window.removeEventListener('focus', wake);
    for (const adapter of adapters) publishSyncStatus(accountId, adapter.module);
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
export function synchronizeAccountOutbox(accountId: string) {
  return accountSenders.get(accountId)?.sender.synchronize();
}

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
