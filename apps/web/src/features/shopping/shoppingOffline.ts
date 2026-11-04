import { hashKey } from '@tanstack/react-query';
import { readSavedAccountSession } from '../../session.js';
import { assertContext, transact } from '../../offline/database.js';
import { registerOfflineModule } from '../../offline/moduleStore.js';
import { appendOperation, readOperations } from '../../offline/outbox.js';
import { notifyOutboxChanged } from '../../offline/signals.js';
import { reportStorageIssue, storageError } from '../../offline/status.js';
import type { ShoppingChange } from './shoppingApi.js';
import { shoppingAdapter, shoppingIntent, takeOverShopping } from './shoppingAdapter.js';
import { projectShopping } from './shoppingOptimistic.js';
import {
  emptyShopping,
  notifyShopping,
  putShoppingTransaction,
  readShoppingChanges,
  readShoppingTransaction,
  shoppingCache,
  shoppingUsesOutbox,
  updateShoppingData,
  type ShoppingData,
} from './shoppingStorage.js';

const aborted = () => new DOMException('Session changed', 'AbortError');
const writeError = (error: unknown) => `Nie można zapisać zakupów. ${storageError(error)}`;
const shoppingModule = registerOfflineModule({
  mode: 'read-write',
  cache: shoppingCache,
  readError: (detail) => `Nie można uruchomić pamięci zakupów. ${detail}`,
  prepareRead: async (tx, account) => {
    if (await shoppingUsesOutbox(tx, account)) return;
    if ((await assertContext(tx)).accountId !== account) throw aborted();
    const saved = await readShoppingTransaction(tx, account);
    if (saved) {
      await takeOverShopping(tx, account, saved);
    } else {
      const session = await readSavedAccountSession(tx, account);
      if (session) await putShoppingTransaction(tx, emptyShopping(session), true);
    }
  },
  readChanges: readShoppingChanges,
  project: (saved, changes) => saved && projectShopping(saved, changes),
  sync: shoppingAdapter,
});

export function createShoppingStore() {
  const store = shoppingModule.createStore();
  async function activeAccount(account: string) {
    const scope = store.accountScope();
    await store.whenReady();
    if (scope.account !== account || !scope.current()) throw aborted();
    return scope;
  }
  async function commit(account: string, write: (tx: IDBTransaction) => Promise<void>) {
    const scope = await activeAccount(account);
    await transact(
      'readwrite',
      async (tx) => {
        if (!scope.current() || (await assertContext(tx)).accountId !== account) throw aborted();
        await write(tx);
        if (!scope.current()) throw aborted();
      },
      scope.token,
    );
    if (!scope.current()) throw aborted();
    await store.reload();
    if (!scope.current()) throw aborted();
    notifyShopping();
  }

  return {
    ...store,
    activate(account: string) {
      const scope = store.accountScope();
      if (scope.account === account && scope.current() && store.snapshot().issue) return store.reload();
      return store.activate(account);
    },
    async fetchRange<T>(
      session: Parameters<typeof emptyShopping>[0],
      queryKey: readonly string[],
      load: () => Promise<T>,
      signal: AbortSignal,
    ) {
      const account = `${session.family.id}:${session.user.id}`;
      const scope = await activeAccount(account);
      const data = await load();
      const assertCurrent = () => {
        signal.throwIfAborted();
        if (!scope.current()) throw aborted();
      };
      assertCurrent();
      const range: ShoppingData['queries'][number] = {
        queryKey,
        queryHash: hashKey(queryKey),
        dehydratedAt: Date.now(),
        state: {
          data,
          dataUpdatedAt: Date.now(),
          dataUpdateCount: 1,
          error: null,
          errorUpdatedAt: 0,
          errorUpdateCount: 0,
          fetchFailureCount: 0,
          fetchFailureReason: null,
          fetchMeta: null,
          fetchStatus: 'idle',
          isInvalidated: false,
          status: 'success',
        },
      };
      try {
        await updateShoppingData(
          account,
          (old) => {
            const saved = old ?? emptyShopping(session);
            return {
              ...saved,
              queries: [...saved.queries.filter((query) => hashKey(query.queryKey) !== range.queryHash), range],
            };
          },
          scope.token,
          assertCurrent,
        );
      } catch (error) {
        assertCurrent();
        reportStorageIssue(writeError(error));
        return { data, scope };
      }
      assertCurrent();
      await store.reload();
      assertCurrent();
      notifyShopping();
      return null;
    },
    async enqueue(account: string, change: ShoppingChange) {
      if (store.snapshot().saved?.account !== account)
        throw new Error('Pamięć zakupów nie jest gotowa. Sprawdź komunikat aktualizacji pamięci i spróbuj ponownie.');
      const operationId = change.type === 'add' || change.type === 'createList' ? change.id : crypto.randomUUID();
      try {
        await commit(account, async (tx) => {
          await appendOperation(
            tx,
            account,
            'shopping',
            shoppingIntent({ change, operationId, submittedAt: Date.now() }),
          );
          await putShoppingTransaction(tx, (await readShoppingTransaction(tx, account))!, true);
        });
      } catch (error) {
        throw new Error(writeError(error));
      }
    },
    async discardReview(account: string) {
      await commit(account, async (tx) => {
        const removed = new Set<string>();
        const keys = new Set<string>();
        for (const op of await readOperations(tx, account)) {
          if (
            (op.module === 'shopping' && op.status === 'needs-review') ||
            op.dependsOn.some((id) => removed.has(id)) ||
            op.orderingKeys.some((key) => keys.has(key))
          ) {
            removed.add(op.operationId);
            op.orderingKeys.forEach((key) => keys.add(key));
            tx.objectStore('outbox').delete([account, op.operationId]);
          }
        }
        if (removed.size) notifyOutboxChanged(tx, account);
        await putShoppingTransaction(tx, (await readShoppingTransaction(tx, account))!, true);
      });
    },
  };
}

export const shoppingStore = createShoppingStore();
export const registerShoppingStore = () => shoppingModule.registerStore(shoppingStore);
