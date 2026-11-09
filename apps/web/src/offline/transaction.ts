import { readSavedAccountSession } from '../session.js';
import { assertContext, hasPendingClear, makeEntry, readAccountCache, requestValue, transact } from './database.js';
import { appendOperation, readOperations, recountOutboxBudgets, type Intent, type Operation } from './outbox.js';
import type { CacheEntry, CacheModule } from './registry.js';
import { notifyOutboxChanged } from './signals.js';

export type OfflineAccountScope = { account: string; token: number; current: () => boolean };
const changed = () => new DOMException('Session changed', 'AbortError');

type SnapshotBudget = { maxBytes?: number; budgetError?: string };
type SnapshotWrite = SnapshotBudget & { queueBytes?: number; engine?: 'legacy-idb' | 'outbox' | 'outbox-v1' };

export function checkSnapshotBudget(
  module: CacheModule,
  snapshot: unknown,
  { maxBytes, budgetError }: SnapshotBudget = {},
) {
  makeEntry(module, snapshot, maxBytes, budgetError);
}

export function offlineTransaction(tx: IDBTransaction, account: string, allowStoredAccount = false) {
  const readMetadata = async (key: string) =>
    (await requestValue<{ value: unknown } | undefined>(tx.objectStore('metadata').get([account, key])))?.value;
  const writeMetadata = (key: string, value: unknown) => {
    tx.objectStore('metadata').put({ accountId: account, key, value });
  };

  return {
    readSnapshot: (module: CacheModule) =>
      allowStoredAccount
        ? requestValue<CacheEntry | undefined>(tx.objectStore('cache').get([account, module, 'snapshot']))
        : readAccountCache(tx, module, account),
    commitSnapshot(
      module: CacheModule,
      snapshot: unknown,
      { queueBytes = 0, engine, maxBytes, budgetError }: SnapshotWrite = {},
    ) {
      const entry = makeEntry(module, snapshot, maxBytes, budgetError);
      if (entry.accountId !== account) throw changed();
      tx.objectStore('cache').put(entry);
      writeMetadata(`budget:${module}`, entry.chargedBytes + queueBytes);
      if (engine) writeMetadata(`engine:${module}`, engine);
    },
    readEngine: (module: CacheModule) => readMetadata(`engine:${module}`),
    readChanges: () => readOperations(tx, account),
    appendChange: (module: CacheModule, intent: Intent) => appendOperation(tx, account, module, intent),
    replaceChange(operation: Operation) {
      if (operation.accountId !== account) throw changed();
      tx.objectStore('outbox').put(operation);
      notifyOutboxChanged(tx, account);
    },
    async removeChanges(ids: ReadonlySet<string>) {
      if (!ids.size) return;
      const store = tx.objectStore('outbox');
      for (const id of ids) store.delete([account, id]);
      await recountOutboxBudgets(tx, account);
    },
    readSession: () => readSavedAccountSession(tx, account),
  };
}

export type OfflineTransaction = ReturnType<typeof offlineTransaction>;

export async function withOfflineAccount<T>(
  mode: 'readonly' | 'readwrite',
  scope: OfflineAccountScope,
  work: (tx: OfflineTransaction) => Promise<T>,
) {
  if (!scope.current()) throw changed();
  return transact(
    mode,
    async (tx) => {
      if (!scope.current() || (await assertContext(tx)).accountId !== scope.account) throw changed();
      const result = await work(offlineTransaction(tx, scope.account));
      if (!scope.current()) throw changed();
      return result;
    },
    scope.token,
  );
}

export type OfflineRead = Pick<OfflineTransaction, 'readSnapshot' | 'readChanges' | 'readEngine'>;

export function readStoredOfflineAccount<T>(work: (tx: OfflineRead, account: string) => Promise<T>) {
  if (hasPendingClear()) throw changed();
  return transact('readonly', async (tx) => {
    const active = await requestValue<{ value: { accountId: string } } | undefined>(
      tx.objectStore('metadata').get(['__origin__', 'active']),
    );
    if (active) return work(offlineTransaction(tx, active.value.accountId, true), active.value.accountId);
  });
}

export function updateAccountRecord<T>(
  key: `${CacheModule}-${string}`,
  update: (value: unknown, save: (next: unknown) => void) => T,
) {
  return transact('readwrite', async (tx) => {
    const { accountId } = await assertContext(tx);
    const store = tx.objectStore('metadata');
    const record = await requestValue<{ value: unknown } | undefined>(store.get([accountId, key]));
    return update(record?.value, (value) => store.put({ accountId, key, value }));
  });
}
