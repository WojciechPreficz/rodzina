import { z } from 'zod';
import {
  createShoppingItemSchema,
  patchShoppingItemSchema,
  shoppingItemSchema,
  shoppingListSchema,
} from '@rodzina/shared';
import type { AccountSession } from '../../session.js';
import type { MealShoppingProjection, ShoppingChange } from './shoppingApi.js';

export const SHOPPING_STORAGE_KEY = 'rodzina:shopping:v1';
const error = (message: string): never => {
  throw new Error(message);
};
const id = z.string().min(1);
export const shoppingChangeSchema = z.discriminatedUnion('type', [
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
  change: shoppingChangeSchema,
  operationId: id,
  submittedAt: z.number().finite().positive(),
});
export const shoppingSessionSchema = z.object({
  user: z.object({ id, familyId: id }).passthrough(),
  family: z.object({ id }).passthrough(),
});
const operationSchema = variablesSchema.extend({
  change: z.union([shoppingChangeSchema, mealProjectionSchema]),
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
