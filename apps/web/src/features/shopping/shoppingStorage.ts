import { mealOfflineChangeSchema, mergeQuantities, normalizeShoppingName } from '@rodzina/shared';
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
import {
  shoppingCache,
  shoppingChangeSchema,
  type ShoppingData,
  type StoredShoppingOperation,
} from './shoppingSnapshot.js';

export const SHOPPING_SIGNAL = 'offline-shopping-changed:1';

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
  change: shoppingChangeSchema.parse(op.payload),
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
    throw new Error('Nieprawidłowa kolejność zapisanych zmian zakupów.');
  return operations;
}
export async function readShoppingTransaction(tx: OfflineRead, account: string) {
  const record = await tx.readSnapshot('shopping');
  if (!record) return;
  const data = shoppingCache.parseCache(record.payload);
  if (record.schemaVersion !== 1 || data.account !== account) throw new Error('Nieobsługiwana wersja pamięci zakupów.');
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
  if (hasPendingClear()) throw new Error('Usuwanie danych konta nie zostało zakończone.');
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
