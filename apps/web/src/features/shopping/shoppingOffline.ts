import { dehydrate, type QueryClient } from '@tanstack/react-query';
import type { AuthUser, Family } from '@rodzina/shared';
import { activateOfflineAccount, accountToken, isAccountCurrent, ensureMigrated } from '../../offline/database.js';
import { reportStorageIssue, storageError as describeStorageError } from '../../offline/status.js';
import { type ShoppingChange } from './shoppingApi.js';
import { shoppingKey, type ShoppingAccount } from './shoppingOptimistic.js';
import {
  readShoppingData,
  updateShoppingData,
  emptyShopping,
  notifyShopping,
  SHOPPING_SIGNAL,
  JOURNAL_PREFIX,
  SHOPPING_STORAGE_KEY,
  type ShoppingData,
} from './shoppingStorage.js';
import { appendOperation, readOperations } from '../../offline/outbox.js';
import { assertContext, transact } from '../../offline/database.js';
import { joinSync } from '../../offline/sync.js';
import { notifyOutboxChanged } from '../../offline/signals.js';
import { shoppingAdapter, shoppingIntent, takeOverShopping } from './shoppingAdapter.js';
import { readShoppingTransaction, putShoppingTransaction } from './shoppingStorage.js';
export { SHOPPING_STORAGE_KEY } from './shoppingStorage.js';
export const PENDING_LOGOUT_KEY = 'rodzina:pending-logout';
export type ShoppingSession = { user: AuthUser; family: Family };
export type QueuedShoppingChange = { change: ShoppingChange; operationId: string; submittedAt: number };
type Runtime = {
  account: string;
  token: number;
  active: boolean;
  sync: ReturnType<typeof joinSync>;
  stop: () => void;
  reload: () => Promise<void>;
  load: (data: ShoppingData) => void;
  schedule: <T>(action: () => Promise<T>) => Promise<T>;
};
const runtimes = new WeakMap<QueryClient, Runtime>();
const restorations = new WeakMap<QueryClient, object>();
const identity = (session: ShoppingSession) => `${session.family.id}:${session.user.id}`;
const aborted = () => new DOMException('Session changed', 'AbortError');
const current = (client: QueryClient, runtime: Runtime) =>
  runtime.active && runtimes.get(client) === runtime && isAccountCurrent(runtime.token);
const matches = (key: readonly unknown[] | undefined, account: ShoppingAccount) =>
  shoppingKey(account).every((part, i) => key?.[i] === part);

export async function readShoppingSession(): Promise<ShoppingSession | undefined> {
  try {
    await ensureMigrated();
    return (await readShoppingData())?.session;
  } catch (error) {
    reportStorageIssue(`Nie można odczytać zakupów. ${describeStorageError(error)}`);
  }
}
export function clearShoppingStorage(client?: QueryClient) {
  if (client) stopShoppingPersistence(client);
  localStorage.removeItem(SHOPPING_STORAGE_KEY);
  for (const key of Object.keys(localStorage)) if (key.startsWith(JOURNAL_PREFIX)) localStorage.removeItem(key);
  // The account registry clears IndexedDB, including the shopping cache and staged imports.
}
export function stopShoppingPersistence(client: QueryClient) {
  restorations.delete(client);
  runtimes.get(client)?.stop();
  runtimes.delete(client);
}
export async function restoreShopping(client: QueryClient, session: ShoppingSession) {
  const accountId = identity(session);
  if (runtimes.get(client)?.account === accountId && current(client, runtimes.get(client)!)) return;
  stopShoppingPersistence(client);
  const token = accountToken();
  const attempt = {};
  restorations.set(client, attempt);
  const valid = () => isAccountCurrent(token) && restorations.get(client) === attempt;
  try {
    await ensureMigrated();
    if (!valid()) return;
    await activateOfflineAccount(accountId);
    if (!valid()) return;
    const account = { familyId: session.family.id, userId: session.user.id };
    const key = shoppingKey(account);
    client.setQueryDefaults(key, { gcTime: Infinity });
    await updateShoppingData(accountId, (old) => old ?? emptyShopping(session), token);
    await readShoppingData(accountId);
    await takeOverShopping(accountId);
    const saved = (await readShoppingData(accountId))!;
    if (!valid()) return;
    let suppress = false;
    let queue = Promise.resolve<unknown>(undefined);
    const schedule = <T>(action: () => Promise<T>): Promise<T> => {
      const next = queue.then(() => {
        if (!current(client, runtime)) throw aborted();
        return action();
      });
      queue = next.catch(() => {});
      return next;
    };
    const load = (data: ShoppingData) => {
      if (!current(client, runtime)) return;
      suppress = true;
      for (const query of client.getQueryCache().findAll({ queryKey: key })) {
        if (query.queryKey[3] === 'items' && data.revokedLists?.includes(String(query.queryKey[4])))
          client.removeQueries({ queryKey: query.queryKey, exact: true });
      }
      // Hydrate alone ignores older timestamps; confirmed IDB changes are authoritative here.
      for (const query of data.queries)
        client.setQueryData(query.queryKey, query.state.data, { updatedAt: query.state.dataUpdatedAt });
      client.setQueryData([...key, 'operations'], data.operations);
      suppress = false;
    };
    const reload = async () => {
      const data = await readShoppingData(accountId);
      if (data && current(client, runtime)) load(data);
    };
    const runtime: Runtime = {
      account: accountId,
      token,
      active: true,
      sync: undefined as unknown as ReturnType<typeof joinSync>,
      schedule,
      reload,
      load,
      stop: () => {
        runtime.active = false;
        runtime.sync?.stop();
        unsubQuery();
        window.removeEventListener(SHOPPING_SIGNAL, onSignal);
        window.removeEventListener('storage', onStorage);
      },
    };
    const unsubQuery = client.getQueryCache().subscribe((event) => {
      if (
        suppress ||
        event.type !== 'updated' ||
        event.action.type !== 'success' ||
        !matches(event.query.queryKey, account) ||
        !['lists', 'items'].includes(String(event.query.queryKey[3])) ||
        event.query.state.data === undefined
      )
        return;
      const query = dehydrate(client, {
        shouldDehydrateQuery: (q) => q === event.query,
        shouldDehydrateMutation: () => false,
      }).queries[0];
      if (!query) return;
      void schedule(async () => {
        await updateShoppingData(
          accountId,
          (old) => ({
            ...old!,
            queries: [
              ...old!.queries.filter((q) => JSON.stringify(q.queryKey) !== JSON.stringify(query.queryKey)),
              query,
            ],
          }),
          token,
        );
      }).catch((error) => {
        if (current(client, runtime)) reportStorageIssue(`Nie można zapisać zakupów. ${describeStorageError(error)}`);
      });
    });
    const onSignal = () => {
      void schedule(reload)
        .then(() => {
          if (current(client, runtime)) runtime.sync.wake();
        })
        .catch(() => {});
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === SHOPPING_SIGNAL) onSignal();
    };
    runtimes.set(client, runtime);
    window.addEventListener(SHOPPING_SIGNAL, onSignal);
    window.addEventListener('storage', onStorage);
    load(saved);
    runtime.sync = joinSync(accountId, shoppingAdapter(account), async () => {
      if (current(client, runtime)) await schedule(reload);
    });
  } catch (error) {
    if (isAccountCurrent(token))
      reportStorageIssue(`Nie można uruchomić pamięci zakupów. ${describeStorageError(error)}`);
  }
}
export async function enqueueShopping(client: QueryClient, account: ShoppingAccount, change: ShoppingChange) {
  const runtime = runtimes.get(client);
  const accountId = `${account.familyId}:${account.userId}`;
  if (!runtime || runtime.account !== accountId || !current(client, runtime))
    throw new Error('Pamięć zakupów nie jest gotowa. Sprawdź komunikat aktualizacji pamięci i spróbuj ponownie.');
  const variables: QueuedShoppingChange = {
    change,
    operationId: change.type === 'add' || change.type === 'createList' ? change.id : crypto.randomUUID(),
    submittedAt: Date.now(),
  };
  try {
    await runtime.schedule(async () => {
      await client.cancelQueries({ queryKey: shoppingKey(account) });
      const saved = await transact(
        'readwrite',
        async (tx) => {
          const active = await assertContext(tx);
          if (active.accountId !== accountId) throw aborted();
          await appendOperation(tx, accountId, 'shopping', shoppingIntent(variables));
          const data = (await readShoppingTransaction(tx, accountId))!;
          await putShoppingTransaction(tx, data, true);
          return data;
        },
        runtime.token,
      );
      runtime.load(saved);
    });
  } catch (error) {
    throw new Error(`Nie można zapisać zakupów. ${describeStorageError(error)}`);
  }
  if (!current(client, runtime)) throw aborted();
  void runtime.sync.refreshStatus().catch((error: unknown) => reportStorageIssue(describeStorageError(error)));
  runtime.sync.wake();
  notifyShopping();
}
export async function discardShoppingReview(client: QueryClient, account: ShoppingAccount) {
  const runtime = runtimes.get(client);
  const accountId = `${account.familyId}:${account.userId}`;
  if (!runtime || !current(client, runtime) || runtime.account !== accountId) throw aborted();
  await runtime.schedule(async () => {
    await transact(
      'readwrite',
      async (tx) => {
        const active = await assertContext(tx);
        if (active.accountId !== accountId) throw aborted();
        const operations = await readOperations(tx, accountId);
        const removed = new Set<string>();
        const keys = new Set<string>();
        for (const op of operations) {
          if (
            (op.module === 'shopping' && op.status === 'needs-review') ||
            op.dependsOn.some((id) => removed.has(id)) ||
            op.orderingKeys.some((key) => keys.has(key))
          ) {
            removed.add(op.operationId);
            op.orderingKeys.forEach((key) => keys.add(key));
            tx.objectStore('outbox').delete([accountId, op.operationId]);
          }
        }
        const data = (await readShoppingTransaction(tx, accountId))!;
        if (removed.size) notifyOutboxChanged(tx, accountId);
        await putShoppingTransaction(tx, data, true);
      },
      runtime.token,
    );
    await runtime.reload();
  });
  await runtime.sync.refreshStatus();
  runtime.sync.wake();
  notifyShopping();
  void client.invalidateQueries({ queryKey: shoppingKey(account) });
}
