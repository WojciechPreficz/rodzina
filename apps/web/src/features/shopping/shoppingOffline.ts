import { dehydrate, hydrate, onlineManager, type QueryClient } from '@tanstack/react-query';
import type { AuthUser, Family, ShoppingItem, ShoppingList } from '@rodzina/shared';
import { assertOfflineReplayAge, OfflineOperationExpiredError } from '@rodzina/shared';
import { apiFetch, ApiRequestError } from '../../api.js';
import { activateOfflineAccount, accountToken, isAccountCurrent, ensureMigrated } from '../../offline/database.js';
import { reportStorageIssue, storageError as describeStorageError } from '../../offline/status.js';
import { changeShopping, type ShoppingChange } from './shoppingApi.js';
import { applyShoppingChange, shoppingKey, type ShoppingAccount } from './shoppingOptimistic.js';
import {
  readShoppingData,
  updateShoppingData,
  emptyShopping,
  notifyShopping,
  SHOPPING_SIGNAL,
  JOURNAL_PREFIX,
  SHOPPING_STORAGE_KEY,
  type ShoppingData,
  type StoredShoppingOperation,
} from './shoppingStorage.js';
export { SHOPPING_STORAGE_KEY } from './shoppingStorage.js';
export const PENDING_LOGOUT_KEY = 'rodzina:pending-logout';
export type ShoppingSession = { user: AuthUser; family: Family };
export type QueuedShoppingChange = { change: ShoppingChange; operationId: string; submittedAt: number };
type Runtime = {
  account: string;
  token: number;
  active: boolean;
  controller: AbortController;
  stop: () => void;
  reload: () => Promise<void>;
  load: (data: ShoppingData) => void;
  schedule: <T>(action: () => Promise<T>) => Promise<T>;
};
const runtimes = new WeakMap<QueryClient, Runtime>();
const restorations = new WeakMap<QueryClient, object>();
const identity = (session: ShoppingSession) => `${session.family.id}:${session.user.id}`;
const aborted = () => new DOMException('Session changed', 'AbortError');
function cancellable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(aborted());
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
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
function projected(data: ShoppingData, account: ShoppingAccount, op: QueuedShoppingChange, response: unknown) {
  const queries = new Map(data.queries.map((q) => [JSON.stringify(q.queryKey), q]));
  const cache = {
    setQueryData: (key: readonly unknown[], update: (old: unknown) => unknown) => {
      const hash = JSON.stringify(key);
      const old = queries.get(hash);
      // A missing range is not an empty list. New local lists have a known empty base.
      const value = update(old?.state.data);
      const template = old ?? data.queries[0];
      if (template)
        queries.set(hash, {
          ...template,
          queryKey: [...key],
          queryHash: hash,
          state: { ...template.state, data: value, dataUpdatedAt: Date.now() },
        });
      return value;
    },
  } as Pick<QueryClient, 'setQueryData'>;
  applyShoppingChange(cache, account, op.change, op.submittedAt);
  const result = response as { item?: ShoppingItem; list?: ShoppingList };
  if (result?.item)
    cache.setQueryData<ShoppingItem[]>([...shoppingKey(account), 'items', result.item.listId], (old = []) =>
      old.map((item) => (item.id === result.item!.id ? result.item! : item)),
    );
  if (result?.list)
    cache.setQueryData<ShoppingList[]>([...shoppingKey(account), 'lists'], (old = []) =>
      old.map((list) => (list.id === result.list!.id ? result.list! : list)),
    );
  return [...queries.values()];
}
export function configureShoppingMutations(client: QueryClient, account: ShoppingAccount) {
  const key = shoppingKey(account);
  const accountId = `${account.familyId}:${account.userId}`;
  client.setQueryDefaults(key, { gcTime: Infinity });
  client.setMutationDefaults(key, {
    scope: { id: accountId },
    gcTime: 300_000,
    networkMode: 'offlineFirst',
    retry: (_count, error) =>
      !(error instanceof OfflineOperationExpiredError) &&
      (error instanceof ApiRequestError ? error.status >= 500 || error.status === 429 : error.name !== 'AbortError'),
    retryDelay: 3000,
    mutationFn: async (variables: QueuedShoppingChange) => {
      const runtime = runtimes.get(client);
      if (!runtime || !current(client, runtime) || runtime.account !== accountId) throw aborted();
      if (!onlineManager.isOnline()) throw new TypeError('Offline');
      // O.3 retains the TanStack sender. Web Locks serialize its instances; O.5 replaces this bridge.
      if (!navigator.locks) throw new Error('Synchronizacja zakupów wymaga obsługi blokad przeglądarki.');
      return navigator.locks.request(`shopping-sender:${accountId}`, async () => {
        if (!current(client, runtime)) throw aborted();
        const data = await readShoppingData(accountId);
        const op = data?.operations.find((entry) => entry.operationId === variables.operationId);
        if (!current(client, runtime)) throw aborted();
        if (!op) return {}; // Another tab has already committed the response.
        if (op.review) throw new DOMException('Zmiana zakupów wymaga sprawdzenia przed synchronizacją.', 'AbortError');
        try {
          assertOfflineReplayAge(op.submittedAt);
        } catch (error) {
          await updateShoppingData(
            accountId,
            (old) => ({
              ...old!,
              operations: old!.operations.map((entry) =>
                entry.operationId === op.operationId ? { ...entry, review: 'expired' } : entry,
              ),
            }),
            runtime.token,
          );
          notifyShopping();
          throw error;
        }
        const first = data!.operations[0];
        if (first?.operationId !== op.operationId) throw new TypeError('Oczekiwanie na wcześniejszą zmianę zakupów.');
        const session = await cancellable(
          apiFetch<ShoppingSession>('/api/auth/me', { signal: runtime.controller.signal }),
          runtime.controller.signal,
        );
        if (!current(client, runtime)) throw aborted();
        if (identity(session) !== accountId) {
          window.dispatchEvent(new Event('rodzina:session-lost'));
          throw aborted();
        }
        const response = await cancellable(
          changeShopping(op.change, op.operationId, account.userId, runtime.controller.signal),
          runtime.controller.signal,
        );
        if (!current(client, runtime)) throw aborted();
        await runtime.schedule(async () => {
          await updateShoppingData(
            accountId,
            (old) => ({
              ...old!,
              queries: projected(old!, account, op, response),
              operations: old!.operations.filter((entry) => entry.operationId !== op.operationId),
            }),
            runtime.token,
          );
        });
        notifyShopping();
        return response;
      });
    },
    onSuccess: async () => {
      await runtimes.get(client)?.reload();
    },
    onError: async (error, variables) => {
      const runtime = runtimes.get(client);
      if (
        !runtime ||
        !current(client, runtime) ||
        error instanceof OfflineOperationExpiredError ||
        error.name === 'AbortError'
      )
        return;
      // Definitive API rejection removes the intent, while retryable transport errors stay pending in TanStack.
      if (error instanceof ApiRequestError && error.status < 500 && error.status !== 429) {
        await updateShoppingData(
          accountId,
          (old) => ({
            ...old!,
            operations: old!.operations.filter(
              (op) => op.operationId !== (variables as QueuedShoppingChange).operationId,
            ),
          }),
          runtime.token,
        );
        await runtime.reload();
        notifyShopping();
      }
    },
    onSettled: () => {
      if (client.isMutating({ mutationKey: key }) <= 1) void client.invalidateQueries({ queryKey: key });
    },
  });
}
function hydrateOperations(client: QueryClient, data: ShoppingData, key: string[]) {
  const existing = new Set(
    client
      .getMutationCache()
      .findAll({ mutationKey: key })
      .map((m) => (m.state.variables as QueuedShoppingChange | undefined)?.operationId),
  );
  hydrate(client, {
    queries: [],
    mutations: data.operations
      .filter((op) => !op.review && !existing.has(op.operationId))
      .map((op) => ({
        mutationKey: key,
        scope: { id: data.account },
        state: {
          context: undefined,
          data: undefined,
          error: null,
          failureCount: 0,
          failureReason: null,
          isPaused: true,
          status: 'pending' as const,
          variables: op,
          submittedAt: op.submittedAt,
        },
      })),
  });
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
    configureShoppingMutations(client, account);
    const saved = await updateShoppingData(accountId, (old) => old ?? emptyShopping(session), token);
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
      // Hydrate alone ignores older timestamps; confirmed IDB changes are authoritative here.
      for (const query of data.queries)
        client.setQueryData(query.queryKey, query.state.data, { updatedAt: query.state.dataUpdatedAt });
      hydrateOperations(client, data, key);
      client.setQueryData([...key, 'operations'], data.operations);
      suppress = false;
      if (data.operations.some((op) => op.review))
        reportStorageIssue(
          'Zapisane zmiany zakupów wymagają sprawdzenia. Nie będą wysyłane automatycznie; zachowano je na urządzeniu.',
        );
    };
    const reload = async () => {
      const data = await readShoppingData(accountId);
      if (data && current(client, runtime)) load(data);
    };
    const runtime: Runtime = {
      account: accountId,
      token,
      active: true,
      controller: new AbortController(),
      schedule,
      reload,
      load,
      stop: () => {
        runtime.active = false;
        runtime.controller.abort();
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
          if (current(client, runtime)) void client.resumePausedMutations();
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
    void client.resumePausedMutations();
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
      const saved = await updateShoppingData(
        accountId,
        (old) => {
          if (!old) throw aborted();
          if (old.operations.some((op) => op.review))
            throw new Error('Najpierw sprawdź zapisane zmiany zakupów wymagające reakcji.');
          return {
            ...old,
            operations: [
              ...old.operations,
              { ...variables, sequence: old.nextSequence } satisfies StoredShoppingOperation,
            ],
            nextSequence: old.nextSequence + 1,
          };
        },
        runtime.token,
      );
      runtime.load(saved);
    });
  } catch (error) {
    throw new Error(`Nie można zapisać zakupów. ${describeStorageError(error)}`);
  }
  if (!current(client, runtime)) throw aborted();
  void client.resumePausedMutations();
  notifyShopping();
}
