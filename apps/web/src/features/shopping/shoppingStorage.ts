import { z } from 'zod';
import type { DehydratedState } from '@tanstack/react-query';
import {
  createShoppingItemSchema,
  patchShoppingItemSchema,
  shoppingListSchema,
  shoppingItemSchema,
  OFFLINE_REPLAY_MAX_AGE_MS,
  mealOfflineChangeSchema,
  normalizeShoppingName,
  mergeQuantities,
} from '@rodzina/shared';
import {
  accountToken,
  isAccountCurrent,
  assertContext,
  requestValue,
  transact,
  registerMigration,
  PROTOCOL_KEY,
  CLEAR_PENDING_KEY,
} from '../../offline/database.js';
import { registerAdapter, chargedBytes, type CacheEntry } from '../../offline/registry.js';
import { requireMigration } from '../../offline/status.js';
import { freezeParticipants, resumeParticipants } from '../../offline/coordinator.js';
import type { QueuedShoppingChange, ShoppingSession } from './shoppingOffline.js';
import type { MealShoppingProjection } from './shoppingApi.js';
import { readOperations, type Operation } from '../../offline/outbox.js';

export const SHOPPING_STORAGE_KEY = 'rodzina:shopping:v1';
export const JOURNAL_PREFIX = `${SHOPPING_STORAGE_KEY}:operation:`;
export const SHOPPING_SIGNAL = 'offline-shopping-changed:1';
const IMPORT_KEY = 'offline-shopping-import:1';
const error = (message: string): never => {
  throw new Error(message);
};
const id = z.string().min(1);
const changeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('createList'), id, name: z.string().min(1) }),
  z.object({ type: z.literal('renameList'), id, name: z.string().min(1) }),
  z.object({ type: z.literal('deleteList'), id }),
  z.object({ type: z.literal('add'), id, listId: id, data: createShoppingItemSchema }),
  z.object({ type: z.literal('edit'), id, listId: id, data: patchShoppingItemSchema }),
  z.object({ type: z.literal('remove'), id, listId: id }),
  z.object({ type: z.literal('clear'), listId: id }),
]);
const mealProjectionSchema = z.object({
  type: z.literal('mealExport'),
  listId: id,
  id,
  ingredients: z.array(z.object({ name: z.string(), quantity: z.string().nullable(), id })),
});
const variablesSchema = z.object({
  change: changeSchema,
  operationId: id,
  submittedAt: z.number().finite().positive(),
});
const mutationSchema = z.object({ mutationKey: z.array(z.unknown()), state: z.object({ variables: variablesSchema }) });
const snapshotSchema = z.object({
  buster: id,
  timestamp: z.number(),
  session: z.object({ user: z.object({ id, familyId: id }).passthrough(), family: z.object({ id }).passthrough() }),
  clientState: z.object({ queries: z.array(z.unknown()), mutations: z.array(z.unknown()) }),
});
const operationSchema = variablesSchema.extend({
  change: z.union([changeSchema, mealProjectionSchema]),
  sequence: z.number().int().positive(),
  review: z
    .enum([
      'snapshot-only',
      'missing-base',
      'ambiguous-order',
      'expired',
      'conflict',
      'rejected',
      'dependency',
      'MEAL_EXPORT_CONFIRMATION_REQUIRED',
    ])
    .optional(),
});
export type StoredShoppingOperation = Omit<QueuedShoppingChange, 'change'> & {
  change: QueuedShoppingChange['change'] | MealShoppingProjection;
  sequence: number;
  review?: string;
};
export type ShoppingData = {
  version: 1;
  account: string;
  session: ShoppingSession;
  queries: DehydratedState['queries'];
  operations: StoredShoppingOperation[];
  nextSequence: number;
  legacyCache: boolean;
  revokedLists?: string[];
};
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
};
function parseQueries(input: unknown[], account: string): DehydratedState['queries'] {
  return input.map((raw) => {
    const query = raw as DehydratedState['queries'][number];
    const key = query?.queryKey;
    if (!Array.isArray(key) || key[0] !== 'shopping' || `${key[1]}:${key[2]}` !== account)
      return error('Nieprawidłowe konto zapisanej listy zakupów.');
    if (key[3] === 'lists' && key.length === 4) {
      const lists = z
        .array(shoppingListSchema.extend({ id, familyId: id, createdBy: id.nullable() }))
        .parse(query.state.data);
      if (lists.some((list) => list.familyId !== key[1])) error('Lista zakupów należy do innej rodziny.');
    } else if (key[3] === 'items' && key.length === 5 && typeof key[4] === 'string') {
      const items = z
        .array(shoppingItemSchema.extend({ id, listId: id, createdBy: id.nullable(), checkedBy: id.nullable() }))
        .parse(query.state.data);
      if (items.some((item) => item.listId !== key[4])) error('Produkt należy do innej listy zakupów.');
    } else return error('Nieobsługiwany zakres pamięci zakupów.');
    return query;
  });
}
registerAdapter({
  module: 'shopping',
  schemaVersion: 1,
  capabilities: 'read-write',
  separateMigration: true,
  legacyKey: SHOPPING_STORAGE_KEY,
  budget: 4 * 1048576,
  parseCache: (value) => {
    const data = value as ShoppingData;
    if (data?.version !== 1 || typeof data.account !== 'string') error('Nieobsługiwany format pamięci zakupów.');
    const session = snapshotSchema.shape.session.parse(data.session);
    if (`${session.family.id}:${session.user.id}` !== data.account || session.user.familyId !== session.family.id)
      error('Zapisane zakupy należą do innego konta.');
    parseQueries(data.queries, data.account);
    z.array(operationSchema).parse(data.operations);
    return data;
  },
  trim: (value) => value,
  describe: (value) => {
    const data = value as ShoppingData;
    return {
      syncedAt: Math.max(0, ...data.queries.map((q) => q.state.dataUpdatedAt)) || null,
      coverage: data.queries.length ? 'partial' : 'missing',
    };
  },
});
function entry(data: ShoppingData, outboxBytes = 0, outbox = false): CacheEntry {
  const record = {
    accountId: data.account,
    module: 'shopping' as const,
    key: 'snapshot',
    schemaVersion: 1 as const,
    payload: outbox ? { ...data, operations: [] } : data,
    syncedAt: Math.max(0, ...data.queries.map((q) => q.state.dataUpdatedAt)) || null,
    coverage: data.queries.length ? ('partial' as const) : ('missing' as const),
    usedAt: Date.now(),
    chargedBytes: 0,
  };
  while (record.chargedBytes !== chargedBytes([data.account, 'shopping', 'snapshot'], record))
    record.chargedBytes = chargedBytes([data.account, 'shopping', 'snapshot'], record);
  const bytes = record.chargedBytes + outboxBytes;
  // Pending work and its base are pinned together. Never trim an operation or manufacture an empty list.
  const pendingBytes = data.operations.length || outboxBytes ? bytes : 0;
  if (pendingBytes > 6 * 1048576 || (!pendingBytes && bytes > 4 * 1048576))
    error('Nie można zapisać zakupów: przekroczono budżet pamięci. Zsynchronizuj zmiany lub zwolnij miejsce.');
  return record;
}
export async function putShoppingTransaction(tx: IDBTransaction, data: ShoppingData, outbox = false) {
  const outboxBytes = outbox
    ? (await readOperations(tx, data.account))
        .filter((op) => op.module === 'shopping')
        .reduce((sum, op) => sum + chargedBytes([data.account, op.operationId], op), 0)
    : 0;
  let record: CacheEntry;
  for (;;) {
    try {
      record = entry(data, outboxBytes, outbox);
      break;
    } catch (cause) {
      if (data.operations.length || outboxBytes) throw cause;
      const evict = data.queries
        .filter((q) => q.queryKey[3] === 'items')
        .sort((a, b) => a.state.dataUpdatedAt - b.state.dataUpdatedAt)[0];
      if (!evict) throw cause;
      data.queries = data.queries.filter((q) => q !== evict);
    }
  }
  tx.objectStore('cache').put(record);
  tx.objectStore('metadata').put({
    accountId: data.account,
    key: 'budget:shopping',
    value: record.chargedBytes + outboxBytes,
  });
  tx.objectStore('metadata').put({
    accountId: data.account,
    key: 'engine:shopping',
    value: outbox ? 'outbox-v1' : 'legacy-idb',
  });
}
export const shoppingOperation = (op: Operation): StoredShoppingOperation => ({
  operationId: op.operationId,
  submittedAt: op.submittedAt,
  change: changeSchema.parse(op.payload),
  sequence: op.sequence,
  ...(op.status === 'needs-review' ? { review: op.reviewReason ?? 'conflict' } : {}),
});
export function mealShoppingOperation(op: Operation): StoredShoppingOperation | undefined {
  if (op.module !== 'meals') return;
  const change = mealOfflineChangeSchema.parse(op.payload);
  if (change.type !== 'export') return;
  const grouped = new Map<string, { name: string; quantity: string | null; id: string }>();
  for (const meal of change.data.snapshot ?? [])
    for (const ingredient of meal.ingredients) {
      const key = normalizeShoppingName(ingredient.name);
      const previous = grouped.get(key);
      const target = change.data.targets?.find((target) => normalizeShoppingName(target.name) === key);
      if (!target) throw new Error('Brak identyfikatora składnika eksportu.');
      grouped.set(key, {
        name: previous?.name ?? ingredient.name,
        id: target.id,
        quantity: mergeQuantities(previous?.quantity, ingredient.quantity),
      });
    }
  return {
    operationId: op.operationId,
    submittedAt: op.submittedAt,
    sequence: op.sequence,
    change: { type: 'mealExport', listId: change.data.listId, id: op.operationId, ingredients: [...grouped.values()] },
    ...(op.status === 'needs-review' ? { review: op.reviewReason ?? 'conflict' } : {}),
  };
}
export async function shoppingUsesOutbox(tx: IDBTransaction, account: string) {
  return (
    (await requestValue<{ value: string } | undefined>(tx.objectStore('metadata').get([account, 'engine:shopping'])))
      ?.value === 'outbox-v1'
  );
}
export async function readShoppingTransaction(tx: IDBTransaction, account: string) {
  const record = await requestValue<CacheEntry | undefined>(
    tx.objectStore('cache').get([account, 'shopping', 'snapshot']),
  );
  if (!record) return;
  const data = record.payload as ShoppingData;
  if (record.schemaVersion !== 1 || data.version !== 1 || data.account !== account)
    error('Nieobsługiwana wersja pamięci zakupów.');
  if (!(await shoppingUsesOutbox(tx, account))) return data;
  const operations = (await readOperations(tx, account)).flatMap((op) => {
    if (op.module === 'shopping') return [shoppingOperation(op)];
    const projection = mealShoppingOperation(op);
    return projection ? [projection] : [];
  });
  return { ...data, operations, nextSequence: Math.max(data.nextSequence, ...operations.map((op) => op.sequence + 1)) };
}
export async function readShoppingData(account?: string) {
  return transact('readonly', async (tx) => {
    const active = account
      ? await assertContext(tx)
      : (
          await requestValue<{ value: { accountId: string } } | undefined>(
            tx.objectStore('metadata').get(['__origin__', 'active']),
          )
        )?.value;
    if (!active || (account && active.accountId !== account)) return;
    const data = await readShoppingTransaction(tx, active.accountId);
    if (!data) return;
    const session = snapshotSchema.shape.session.parse(data.session);
    if (`${session.family.id}:${session.user.id}` !== data.account || session.user.familyId !== session.family.id)
      error('Zapisane zakupy należą do innego konta.');
    parseQueries(data.queries, data.account);
    const operations = z.array(operationSchema).parse(data.operations);
    if (
      !Number.isSafeInteger(data.nextSequence) ||
      data.nextSequence < 1 ||
      operations.some(
        (op, i) => op.sequence >= data.nextSequence || (i > 0 && op.sequence <= operations[i - 1]!.sequence),
      ) ||
      new Set(operations.map((op) => op.operationId)).size !== operations.length
    )
      error('Nieprawidłowa kolejność zapisanych zmian zakupów.');
    return data;
  });
}
export async function updateShoppingData(
  account: string,
  update: (old: ShoppingData | undefined) => ShoppingData,
  token = accountToken(),
) {
  if (localStorage.getItem(CLEAR_PENDING_KEY)) error('Usuwanie danych konta nie zostało zakończone.');
  return transact(
    'readwrite',
    async (tx) => {
      const active = await assertContext(tx);
      if (active.accountId !== account) throw new DOMException('Session changed', 'AbortError');
      const value = update(await readShoppingTransaction(tx, account));
      if (value.account !== account) throw new DOMException('Session changed', 'AbortError');
      await putShoppingTransaction(tx, value, await shoppingUsesOutbox(tx, account));
      return value;
    },
    token,
  );
}
export function notifyShopping() {
  // The signal contains no account content and is not a sender lock.
  try {
    localStorage.setItem(SHOPPING_SIGNAL, crypto.randomUUID());
  } catch {
    /* IDB is authoritative. */
  }
  window.dispatchEvent(new Event(SHOPPING_SIGNAL));
}
export function emptyShopping(session: ShoppingSession): ShoppingData {
  return {
    version: 1,
    account: `${session.family.id}:${session.user.id}`,
    session: { user: { ...session.user, email: null }, family: { ...session.family, joinCode: '' } },
    queries: [],
    operations: [],
    nextSequence: 1,
    legacyCache: false,
  };
}
const sources = () =>
  Object.fromEntries(
    Object.keys(localStorage)
      .filter((key) => key === SHOPPING_STORAGE_KEY || key.startsWith(JOURNAL_PREFIX))
      .sort()
      .map((key) => [key, localStorage.getItem(key)!]),
  );
type ImportState = {
  accountId: string;
  module: 'shopping';
  importId: 'v1';
  phase: 'staged' | 'committed' | 'verified';
  source: Record<string, string>;
  data: ShoppingData;
  boundary: unknown;
  sourceDigest: string;
  targetDigest: string;
};
const digest = async (value: unknown) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
function assertSource(state: ImportState, removed = false) {
  const current = sources();
  if (
    Object.keys(current).some((key) => !(key in state.source)) ||
    Object.entries(state.source).some(
      ([key, value]) => current[key] !== value && !(removed && current[key] === undefined),
    )
  )
    error('Dane zakupów zmieniły się podczas importu. Zamknij starsze karty i ponów aktualizację.');
}
export function importShopping(source: Record<string, string>, fallback?: ShoppingSession): ShoppingData {
  const snapshot = source[SHOPPING_STORAGE_KEY]
    ? snapshotSchema.parse(JSON.parse(source[SHOPPING_STORAGE_KEY]))
    : undefined;
  const session = (snapshot?.session as ShoppingSession | undefined) ?? fallback;
  if (!session || session.user.familyId !== session.family.id)
    return error('Nie można potwierdzić konta dziennika zakupów.');
  const data = emptyShopping(session);
  if (snapshot && snapshot.buster !== data.account) error('Snapshot zakupów należy do innego konta.');
  data.queries = parseQueries(snapshot?.clientState.queries ?? [], data.account);
  data.legacyCache = true;
  const snapshots = new Map<string, QueuedShoppingChange>();
  const journal = new Map<string, QueuedShoppingChange>();
  const parse = (raw: unknown) => {
    const mutation = mutationSchema.parse(raw);
    if (canonical(mutation.mutationKey) !== canonical(['shopping', session.family.id, session.user.id]))
      error('Dziennik zakupów należy do innego konta.');
    const op = mutation.state.variables;
    if ((op.change.type === 'add' || op.change.type === 'createList') && op.operationId !== op.change.id)
      error('Niezgodny lokalny identyfikator operacji zakupów.');
    return op;
  };
  for (const raw of snapshot?.clientState.mutations ?? []) {
    const op = parse(raw);
    if (snapshots.has(op.operationId) && canonical(snapshots.get(op.operationId)) !== canonical(op))
      error('Sprzeczne kopie operacji zakupów.');
    snapshots.set(op.operationId, op);
  }
  for (const [key, raw] of Object.entries(source))
    if (key.startsWith(JOURNAL_PREFIX)) {
      const op = parse(JSON.parse(raw));
      if (key !== `${JOURNAL_PREFIX}${data.account}:${op.operationId}`) error('Nieprawidłowy klucz dziennika zakupów.');
      if (snapshots.has(op.operationId) && canonical(snapshots.get(op.operationId)) !== canonical(op))
        error('Sprzeczne kopie operacji zakupów. Źródło zostało zachowane.');
      journal.set(op.operationId, op);
    }
  const all = new Map([...snapshots, ...journal]);
  const resource = (op: QueuedShoppingChange) => ('listId' in op.change ? op.change.listId : op.change.id);
  const chains = new Map<string, QueuedShoppingChange[]>();
  for (const op of all.values()) chains.set(resource(op), [...(chains.get(resource(op)) ?? []), op]);
  const byTime = (a: QueuedShoppingChange, b: QueuedShoppingChange) =>
    a.submittedAt - b.submittedAt || (a.operationId < b.operationId ? -1 : 1);
  for (const chain of chains.values()) {
    if (chain.every((op) => snapshots.has(op.operationId)))
      chain.sort((a, b) => [...snapshots.keys()].indexOf(a.operationId) - [...snapshots.keys()].indexOf(b.operationId));
    else chain.sort(byTime);
  }
  const ordered: QueuedShoppingChange[] = [];
  const remaining = [...chains.values()].map((chain) => [...chain]);
  while (remaining.some((chain) => chain.length)) {
    const next = remaining.flatMap((chain) => (chain[0] ? [chain[0]] : [])).sort(byTime)[0]!;
    ordered.push(next);
    remaining.find((chain) => chain[0] === next)!.shift();
  }
  for (const op of ordered) {
    const chain = ordered.filter((other) => resource(other) === resource(op));
    const hasItems =
      !('listId' in op.change) ||
      data.queries.some((q) => q.queryKey[3] === 'items' && q.queryKey[4] === resource(op)) ||
      ordered.some((other) => other.change.type === 'createList' && other.change.id === resource(op));
    const hasBase =
      hasItems &&
      (op.change.type === 'createList' ||
        data.queries.some(
          (q) =>
            q.queryKey[3] === 'lists' && (q.state.data as { id: string }[]).some((list) => list.id === resource(op)),
        ) ||
        ordered.some((other) => other.change.type === 'createList' && other.change.id === resource(op)));
    const ambiguous =
      !chain.every((other) => snapshots.has(other.operationId)) &&
      chain.some((a, i) => chain.some((b, j) => i !== j && a.submittedAt === b.submittedAt));
    const review = !journal.has(op.operationId)
      ? 'snapshot-only'
      : !hasBase
        ? 'missing-base'
        : ambiguous
          ? 'ambiguous-order'
          : Date.now() - op.submittedAt > OFFLINE_REPLAY_MAX_AGE_MS
            ? 'expired'
            : undefined;
    data.operations.push({ ...op, sequence: data.nextSequence++, ...(review ? { review } : {}) });
  }
  entry(data);
  return data;
}
async function migrateShopping(confirmed: boolean) {
  const token = accountToken();
  const work = async () => {
    if (localStorage.getItem(CLEAR_PENDING_KEY)) error('Usuwanie danych konta nie zostało zakończone.');
    const states = await transact(
      'readonly',
      async (tx) => requestValue<ImportState[]>(tx.objectStore('migration').getAll()),
      token,
    );
    let state = states.find((s) => s.module === 'shopping');
    const source = sources();
    if (!state && !Object.keys(source).length) return;
    if (!state) {
      const markers = await transact(
        'readonly',
        async (tx) => requestValue<{ key: string }[]>(tx.objectStore('metadata').getAll()),
        token,
      );
      if (markers.some((m) => m.key === 'import:shopping:v1' || m.key === 'engine:shopping'))
        error('Starsza karta ponownie zapisała zakupy po aktualizacji. Zamknij ją i wyloguj się przed dalszą pracą.');
    }
    if (!confirmed && localStorage.getItem(IMPORT_KEY) !== 'migrating') {
      requireMigration(true);
      error('Dane zakupów wymagają przeniesienia. Zamknij starsze karty aplikacji i potwierdź aktualizację pamięci.');
    }
    if (!navigator.locks?.query) error('Przeglądarka nie obsługuje bezpiecznej aktualizacji pamięci zakupów.');
    localStorage.setItem(IMPORT_KEY, 'migrating');
    localStorage.setItem(PROTOCOL_KEY, 'migrating');
    await freezeParticipants();
    const boundary = async (tx: IDBTransaction) =>
      requestValue(tx.objectStore('metadata').get(['__origin__', 'boundary']));
    const check = async (tx: IDBTransaction, s: ImportState) => {
      if (canonical(await boundary(tx)) !== canonical(s.boundary))
        throw new DOMException('Session changed', 'AbortError');
    };
    if (!state) {
      const family = await transact(
        'readonly',
        async (tx) => requestValue<CacheEntry[]>(tx.objectStore('cache').getAll()),
        token,
      );
      const fallback = (family.find((e) => e.module === 'family')?.payload as { session?: ShoppingSession } | undefined)
        ?.session;
      const data = importShopping(source, fallback);
      const active = await transact(
        'readonly',
        async (tx) =>
          requestValue<{ value: { accountId: string } } | undefined>(
            tx.objectStore('metadata').get(['__origin__', 'active']),
          ),
        token,
      );
      if (active && active.value.accountId !== data.account) error('Dane zakupów należą do innego konta.');
      state = {
        accountId: data.account,
        module: 'shopping',
        importId: 'v1',
        phase: 'staged',
        source,
        data,
        boundary: await transact('readonly', boundary, token),
        sourceDigest: await digest(source),
        targetDigest: await digest(data),
      };
      if (chargedBytes(data.account, state) > 48 * 1048576) error('Brak miejsca na kopię importu zakupów.');
      const estimate = await navigator.storage?.estimate?.();
      const needed = 2 * new TextEncoder().encode(JSON.stringify([source, data])).byteLength + 1048576;
      if (estimate?.quota !== undefined && estimate.usage !== undefined && estimate.quota - estimate.usage < needed)
        error('Brak miejsca na bezpieczny import zakupów.');
      assertSource(state);
      const staged = state;
      await transact(
        'readwrite',
        async (tx) => {
          await check(tx, staged);
          tx.objectStore('migration').put(staged);
        },
        token,
      );
    }
    if ((await digest(state.source)) !== state.sourceDigest || (await digest(state.data)) !== state.targetDigest)
      error('Kopia robocza importu zakupów jest uszkodzona. Źródło zostało zachowane.');
    if (state.phase === 'staged') {
      assertSource(state);
      const staged = state;
      await transact(
        'readwrite',
        async (tx) => {
          await check(tx, staged);
          const active = await requestValue<{ value: { accountId: string } } | undefined>(
            tx.objectStore('metadata').get(['__origin__', 'active']),
          );
          if (active && active.value.accountId !== staged.accountId)
            throw new DOMException('Session changed', 'AbortError');
          await putShoppingTransaction(tx, staged.data);
          if (!active)
            tx.objectStore('metadata').put({
              accountId: '__origin__',
              key: 'active',
              value: { accountId: staged.accountId, generation: crypto.randomUUID() },
            });
          tx.objectStore('migration').put({ ...staged, phase: 'committed' });
        },
        token,
      );
      state = { ...state, phase: 'committed' };
    }
    const captured = state;
    if (state.phase === 'committed') {
      assertSource(state);
      await transact(
        'readwrite',
        async (tx) => {
          await check(tx, captured);
          const actual = await requestValue<CacheEntry>(
            tx.objectStore('cache').get([captured.accountId, 'shopping', 'snapshot']),
          );
          if (canonical(actual?.payload) !== canonical(captured.data))
            error('Weryfikacja importu zakupów nie powiodła się.');
          tx.objectStore('migration').put({ ...captured, phase: 'verified' });
        },
        token,
      );
    }
    if (!isAccountCurrent(token)) throw new DOMException('Session changed', 'AbortError');
    assertSource(captured, true);
    for (const key of Object.keys(captured.source)) localStorage.removeItem(key);
    if (Object.keys(captured.source).some((key) => localStorage.getItem(key) !== null))
      error('Nie można usunąć starej pamięci zakupów.');
    await transact(
      'readwrite',
      async (tx) => {
        await check(tx, captured);
        tx.objectStore('migration').delete([captured.accountId, 'shopping', 'v1']);
        tx.objectStore('metadata').put({ accountId: captured.accountId, key: 'import:shopping:v1', value: 'active' });
      },
      token,
    );
    localStorage.setItem(IMPORT_KEY, 'active');
    localStorage.setItem(PROTOCOL_KEY, 'active');
    requireMigration(false);
    resumeParticipants();
  };
  if (navigator.locks) await navigator.locks.request(IMPORT_KEY, work);
  else await work();
}
registerMigration('shopping', migrateShopping);
