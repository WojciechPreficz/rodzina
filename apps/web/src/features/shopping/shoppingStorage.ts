import type { AccountSession } from '../../session.js';
import { z } from 'zod';
import {
  createShoppingItemSchema,
  patchShoppingItemSchema,
  shoppingListSchema,
  shoppingItemSchema,
  mealOfflineChangeSchema,
  normalizeShoppingName,
  mergeQuantities,
} from '@rodzina/shared';
import {
  accountToken,
  hasPendingClear,
  isAccountCurrent,
  withOfflineAccount,
  readStoredOfflineAccount,
  chargedBytes,
  SnapshotBudgetError,
  type OfflineRead,
  type OfflineTransaction,
  type Operation,
} from '../../offline/index.js';
import type { ShoppingChange, MealShoppingProjection } from './shoppingApi.js';

export const SHOPPING_STORAGE_KEY = 'rodzina:shopping:v1';
export const SHOPPING_SIGNAL = 'offline-shopping-changed:1';
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
export const variablesSchema = z.object({
  change: changeSchema,
  operationId: id,
  submittedAt: z.number().finite().positive(),
});
export const shoppingSessionSchema = z.object({
  user: z.object({ id, familyId: id }).passthrough(),
  family: z.object({ id }).passthrough(),
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
export type QueuedShoppingChange = { change: ShoppingChange; operationId: string; submittedAt: number };
export type StoredShoppingOperation = Omit<QueuedShoppingChange, 'change'> & {
  change: QueuedShoppingChange['change'] | MealShoppingProjection;
  sequence: number;
  review?: string;
};
const shoppingRangeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('lists'),
    data: z.array(shoppingListSchema.extend({ id, familyId: id, createdBy: id.nullable() })),
    syncedAt: z.number().finite().nonnegative(),
  }),
  z.object({
    kind: z.literal('items'),
    listId: id,
    data: z.array(shoppingItemSchema.extend({ id, listId: id, createdBy: id.nullable(), checkedBy: id.nullable() })),
    syncedAt: z.number().finite().nonnegative(),
  }),
]);
export type ShoppingRange = z.infer<typeof shoppingRangeSchema>;
export const rangeListId = (range: ShoppingRange) => (range.kind === 'items' ? range.listId : null);
export type ShoppingData = {
  version: 2;
  account: string;
  session: AccountSession;
  ranges: ShoppingRange[];
  operations: StoredShoppingOperation[];
  nextSequence: number;
  legacyCache: boolean;
  revokedLists?: string[];
};
const legacyQuerySchema = z.object({
  queryKey: z.array(z.unknown()),
  state: z.object({ data: z.unknown(), dataUpdatedAt: z.number().finite().nonnegative() }),
});

function parseRange(raw: unknown, account: string) {
  const range = shoppingRangeSchema.parse(raw);
  if (range.kind === 'lists' && range.data.some((list) => list.familyId !== account.split(':')[0]))
    error('Lista zakupów należy do innej rodziny.');
  if (range.kind === 'items' && range.data.some((item) => item.listId !== range.listId))
    error('Produkt należy do innej listy zakupów.');
  return range;
}

export function shoppingRange(key: readonly unknown[], data: unknown, syncedAt: number, account: string) {
  if (key[0] !== 'shopping' || `${key[1]}:${key[2]}` !== account)
    return error('Nieprawidłowe konto zapisanej listy zakupów.');
  if (key[3] === 'lists' && key.length === 4) return parseRange({ kind: 'lists', data, syncedAt }, account);
  if (key[3] === 'items' && key.length === 5)
    return parseRange({ kind: 'items', listId: key[4], data, syncedAt }, account);
  return error('Nieobsługiwany zakres pamięci zakupów.');
}

export function legacyRanges(input: unknown, account: string) {
  return z
    .array(legacyQuerySchema)
    .parse(input)
    .map(({ queryKey, state }) => shoppingRange(queryKey, state.data, state.dataUpdatedAt, account));
}

function parseShoppingCache(value: unknown): ShoppingData {
  const data = value as Omit<ShoppingData, 'version'> & { version: number; queries?: unknown };
  if ((data?.version !== 1 && data?.version !== 2) || typeof data.account !== 'string')
    error('Nieobsługiwany format pamięci zakupów.');
  const session = shoppingSessionSchema.parse(data.session);
  if (`${session.family.id}:${session.user.id}` !== data.account || session.user.familyId !== session.family.id)
    error('Zapisane zakupy należą do innego konta.');
  z.array(operationSchema).parse(data.operations);
  const { queries, ...rest } = data;
  const ranges =
    data.version === 1
      ? legacyRanges(queries, data.account)
      : data.ranges.map((range) => parseRange(range, data.account));
  return { ...rest, version: 2, ranges };
}

export const shoppingCache = {
  module: 'shopping' as const,
  schemaVersion: 1 as const,
  separateMigration: true,
  legacyKey: SHOPPING_STORAGE_KEY,
  budget: 4 * 1048576,
  parseCache: parseShoppingCache,
  trim: (value: unknown) => value,
  describe: (value: unknown) => {
    const data = parseShoppingCache(value);
    return {
      syncedAt: Math.max(0, ...data.ranges.map((q) => q.syncedAt)) || null,
      coverage: data.ranges.length ? ('partial' as const) : ('missing' as const),
    };
  },
};
export const shoppingBudgetError =
  'Nie można zapisać zakupów: przekroczono budżet pamięci. Zsynchronizuj zmiany lub zwolnij miejsce.';

export async function putShoppingTransaction(tx: OfflineTransaction, data: ShoppingData, outbox = false) {
  const outboxBytes = outbox
    ? (await tx.readChanges())
        .filter((op) => op.module === 'shopping')
        .reduce((sum, op) => sum + chargedBytes([data.account, op.operationId], op), 0)
    : 0;
  for (;;) {
    try {
      // Pending work and its base are pinned together.
      tx.commitSnapshot('shopping', outbox ? { ...data, operations: [] } : data, {
        maxBytes: (data.operations.length || outboxBytes ? 6 * 1048576 : shoppingCache.budget) - outboxBytes,
        queueBytes: outboxBytes,
        engine: outbox ? 'outbox-v1' : 'legacy-idb',
        budgetError: shoppingBudgetError,
      });
      return;
    } catch (cause) {
      if (!(cause instanceof SnapshotBudgetError) || data.operations.length || outboxBytes) throw cause;
      const evict = data.ranges.filter((q) => q.kind === 'items').sort((a, b) => a.syncedAt - b.syncedAt)[0];
      if (!evict) throw cause;
      data.ranges = data.ranges.filter((q) => q !== evict);
    }
  }
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
export async function shoppingUsesOutbox(tx: OfflineRead) {
  return (await tx.readEngine('shopping')) === 'outbox-v1';
}
export async function readShoppingChanges(tx: OfflineRead, data: ShoppingData | undefined) {
  if (!data) return [];
  const outbox = await shoppingUsesOutbox(tx);
  const operations = outbox
    ? (await tx.readChanges()).flatMap((op) => {
        if (op.module === 'shopping') return [shoppingOperation(op)];
        const projection = mealShoppingOperation(op);
        return projection ? [projection] : [];
      })
    : data.operations;
  if (
    !Number.isSafeInteger(data.nextSequence) ||
    data.nextSequence < 1 ||
    operations.some(
      (op, i) => (!outbox && op.sequence >= data.nextSequence) || (i > 0 && op.sequence <= operations[i - 1]!.sequence),
    ) ||
    new Set(operations.map((op) => op.operationId)).size !== operations.length
  )
    error('Nieprawidłowa kolejność zapisanych zmian zakupów.');
  return operations;
}
export async function readShoppingTransaction(tx: OfflineRead, account: string) {
  const record = await tx.readSnapshot('shopping');
  if (!record) return;
  const data = shoppingCache.parseCache(record.payload);
  if (record.schemaVersion !== 1 || data.account !== account) error('Nieobsługiwana wersja pamięci zakupów.');
  const operations = await readShoppingChanges(tx, data);
  return { ...data, operations, nextSequence: Math.max(data.nextSequence, ...operations.map((op) => op.sequence + 1)) };
}
export async function readShoppingData(account?: string) {
  if (!account) return readStoredOfflineAccount(readShoppingTransaction);
  const token = accountToken();
  return withOfflineAccount('readonly', { account, token, current: () => isAccountCurrent(token) }, (tx) =>
    readShoppingTransaction(tx, account),
  );
}
export async function updateShoppingData(
  account: string,
  update: (old: ShoppingData | undefined) => ShoppingData,
  token = accountToken(),
  assertCurrent?: () => void,
) {
  if (hasPendingClear()) error('Usuwanie danych konta nie zostało zakończone.');
  return withOfflineAccount('readwrite', { account, token, current: () => isAccountCurrent(token) }, async (tx) => {
    const old = await readShoppingTransaction(tx, account);
    assertCurrent?.();
    const value = update(old);
    await putShoppingTransaction(tx, value, await shoppingUsesOutbox(tx));
    assertCurrent?.();
    return value;
  });
}
export function notifyShopping() {
  // The signal contains no account content and is not a sender lock.
  try {
    localStorage.setItem(SHOPPING_SIGNAL, crypto.randomUUID());
  } catch {
    /* IDB is authoritative. */
  }
}
export function emptyShopping(session: AccountSession): ShoppingData {
  return {
    version: 2,
    account: `${session.family.id}:${session.user.id}`,
    session: { user: { ...session.user, email: null }, family: { ...session.family, joinCode: '' } },
    ranges: [],
    operations: [],
    nextSequence: 1,
    legacyCache: false,
  };
}
