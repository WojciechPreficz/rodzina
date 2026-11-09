import {
  registerOfflineModule,
  reportStorageIssue,
  storageError,
  type OfflineTransaction,
} from '../../offline/index.js';
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
  shoppingRange,
  rangeListId,
  shoppingUsesOutbox,
  updateShoppingData,
} from './shoppingStorage.js';

const aborted = () => new DOMException('Session changed', 'AbortError');
const writeError = (error: unknown) => `Nie można zapisać zakupów. ${storageError(error)}`;
const shoppingModule = registerOfflineModule({
  mode: 'read-write',
  cache: shoppingCache,
  readError: (detail) => `Nie można uruchomić pamięci zakupów. ${detail}`,
  prepareRead: async (tx, account) => {
    if (await shoppingUsesOutbox(tx)) return;
    const saved = await readShoppingTransaction(tx, account);
    if (saved) {
      await takeOverShopping(tx, saved);
    } else {
      const session = await tx.readSession();
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
  async function commit(account: string, write: (tx: OfflineTransaction) => Promise<void>) {
    const scope = await activeAccount(account);
    await shoppingModule.withAccount('readwrite', scope, write);
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
      try {
        const range = shoppingRange(queryKey, data, Date.now(), account);
        await updateShoppingData(
          account,
          (old) => {
            const saved = old ?? emptyShopping(session);
            return {
              ...saved,
              ranges: [...saved.ranges.filter((old) => rangeListId(old) !== rangeListId(range)), range],
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
          await tx.appendChange('shopping', shoppingIntent({ change, operationId, submittedAt: Date.now() }));
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
        for (const op of await tx.readChanges()) {
          if (
            (op.module === 'shopping' && op.status === 'needs-review') ||
            op.dependsOn.some((id) => removed.has(id)) ||
            op.orderingKeys.some((key) => keys.has(key))
          ) {
            removed.add(op.operationId);
            op.orderingKeys.forEach((key) => keys.add(key));
          }
        }
        await tx.removeChanges(removed);
        await putShoppingTransaction(tx, (await readShoppingTransaction(tx, account))!, true);
      });
    },
  };
}

export const shoppingStore = createShoppingStore();
export const registerShoppingStore = () => shoppingModule.registerStore(shoppingStore);
