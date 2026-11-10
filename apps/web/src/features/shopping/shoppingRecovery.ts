import { z } from 'zod';
import { OFFLINE_REPLAY_MAX_AGE_MS } from '@rodzina/shared';
import type { AccountSession } from '../../session.js';
import { checkSnapshotBudget, createRecordRecovery } from '../../offline/index.js';
import {
  emptyShopping,
  legacyRanges,
  putShoppingTransaction,
  shoppingBudgetError,
  shoppingCache,
  shoppingSessionSchema,
  SHOPPING_STORAGE_KEY,
  variablesSchema,
  type QueuedShoppingChange,
  type ShoppingData,
} from './shoppingStorage.js';

export const JOURNAL_PREFIX = `${SHOPPING_STORAGE_KEY}:operation:`;
const error = (message: string): never => {
  throw new Error(message);
};
const mutationSchema = z.object({ mutationKey: z.array(z.unknown()), state: z.object({ variables: variablesSchema }) });
const snapshotSchema = z.object({
  buster: z.string().min(1),
  timestamp: z.number(),
  session: shoppingSessionSchema,
  clientState: z.object({ queries: z.array(z.unknown()), mutations: z.array(z.unknown()) }),
});
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
};
export function importShopping(source: Record<string, string>, fallback?: AccountSession): ShoppingData {
  const snapshot = source[SHOPPING_STORAGE_KEY]
    ? snapshotSchema.parse(JSON.parse(source[SHOPPING_STORAGE_KEY]))
    : undefined;
  const session = (snapshot?.session as AccountSession | undefined) ?? fallback;
  if (!session || session.user.familyId !== session.family.id)
    return error('Nie można potwierdzić konta dziennika zakupów.');
  const data = emptyShopping(session);
  if (snapshot && snapshot.buster !== data.account) error('Snapshot zakupów należy do innego konta.');
  data.ranges = legacyRanges(snapshot?.clientState.queries ?? [], data.account);
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
      data.ranges.some((q) => q.kind === 'items' && q.listId === resource(op)) ||
      ordered.some((other) => other.change.type === 'createList' && other.change.id === resource(op));
    const hasBase =
      hasItems &&
      (op.change.type === 'createList' ||
        data.ranges.some((q) => q.kind === 'lists' && q.data.some((list) => list.id === resource(op))) ||
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
  return data;
}
export const recoverShopping = createRecordRecovery(
  'shopping',
  SHOPPING_STORAGE_KEY,
  (source, _account, preview) => {
    const data = importShopping(source, (preview as { session?: AccountSession } | undefined)?.session);
    checkSnapshotBudget('shopping', data, {
      maxBytes: data.operations.length ? 6 * 1048576 : shoppingCache.budget,
      budgetError: shoppingBudgetError,
    });
    return data;
  },
  (tx, value) => putShoppingTransaction(tx, shoppingCache.parseCache(value)),
  {
    journalPrefix: JOURNAL_PREFIX,
    previewFallback: 'family',
    normalize: shoppingCache.parseCache,
    // Keep digests and locking compatible with interrupted legacy imports.
    encode: canonical,
    lock: 'module',
  },
);

export function validateShoppingRecoveryAccount(account: string) {
  const shopping = localStorage.getItem(SHOPPING_STORAGE_KEY);
  if (!shopping) return;
  const { buster } = JSON.parse(shopping) as { buster?: string };
  if (buster && buster !== account) error('Dane offline należą do różnych kont. Wyloguj się i pobierz je ponownie.');
}
