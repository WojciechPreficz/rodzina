import { z } from 'zod';
import {
  operationSchema,
  snapshotSchema,
  discardSchema,
  classify,
  taskOrderingKeys,
  TASK_STORAGE_KEY,
} from './taskSchemas.js';
import {
  accountToken,
  cacheSignal,
  chargedBytes,
  hasPendingClear,
  isAccountCurrent,
  withOfflineAccount,
  checkSnapshotBudget,
  type OfflineTransaction,
  type Operation,
} from '../../offline/index.js';
const dataSchema = z.object({
  version: z.literal(1),
  account: z.string().min(1),
  snapshot: snapshotSchema,
  operations: z.array(operationSchema),
  discards: z.record(discardSchema),
  rejection: z.string().optional(),
});
export type TaskData = z.infer<typeof dataSchema>;
const TASK_SIGNAL = cacheSignal('tasks');
function parse(value: unknown): TaskData {
  const data = dataSchema.parse(value);
  const [family, user] = data.account.split(':');
  const lists = data.snapshot.lists;
  if (
    !family ||
    !user ||
    data.snapshot.account !== data.account ||
    (lists &&
      (new Set(lists.map((list) => list.id)).size !== lists.length ||
        lists.some((list) => list.familyId !== family || (list.ownerId !== user && !list.memberIds.includes(user))))) ||
    Object.entries(data.snapshot.items).some(
      ([id, tasks]) =>
        (lists && !lists.some((list) => list.id === id)) ||
        new Set(tasks.map((task) => task.id)).size !== tasks.length ||
        tasks.some(
          (task) =>
            task.listId !== id ||
            (task.checklist &&
              (new Set(task.checklist.map((item) => item.id)).size !== task.checklist.length ||
                task.checklist.some((item) => item.taskId !== task.id))),
        ),
    ) ||
    new Set(data.operations.map((op) => op.id)).size !== data.operations.length
  )
    throw new Error('Nieprawidłowe konto lub powiązania zapisanych zadań.');
  const discarded = new Set(Object.values(data.discards).flatMap((entry) => entry.operationIds));
  data.operations = data.operations.filter((op) => !discarded.has(op.id));
  return data;
}
export const taskBudgetError =
  'Nie można zapisać zadań: przekroczono budżet pamięci. Zsynchronizuj zmiany lub zwolnij miejsce.';
export const taskCache = {
  module: 'tasks',
  schemaVersion: 1,
  separateMigration: true,
  legacyKey: TASK_STORAGE_KEY,
  budget: 6 * 1048576,
  parseCache: parse,
  trim: (value: unknown) => value,
  describe: (value: unknown) => {
    const { snapshot } = parse(value);
    return {
      syncedAt: snapshot.syncedAt ?? null,
      coverage: snapshot.lists ? ('partial' as const) : ('missing' as const),
    };
  },
} as const;
export function taskOperation(operation: Operation) {
  return operationSchema.parse({
    ...(operation.payload as object),
    id: operation.operationId,
    submittedAt: operation.submittedAt,
    status: operation.status === 'needs-review' ? 'needs-review' : 'pending',
    reason: operation.status === 'needs-review' ? operation.reviewReason : undefined,
  });
}
async function readTaskBase(tx: OfflineTransaction, account: string): Promise<TaskData> {
  const record = await tx.readSnapshot('tasks');
  if (record && record.schemaVersion !== 1) throw new Error('Nieobsługiwana wersja pamięci zadań.');
  const data = record
    ? parse(record.payload)
    : {
        version: 1 as const,
        account,
        snapshot: { account, items: {} },
        operations: [],
        discards: {},
      };
  if (data.account !== account) throw new DOMException('Session changed', 'AbortError');
  return data;
}
async function usesOutbox(tx: OfflineTransaction) {
  return (await tx.readEngine('tasks')) === 'outbox';
}
export async function readTaskChanges(tx: OfflineTransaction, saved: TaskData | undefined) {
  if (!(await usesOutbox(tx))) return (saved?.operations ?? []).map((operation) => ({ operation, error: undefined }));
  return (await tx.readChanges())
    .filter((op) => op.module === 'tasks')
    .map((op) => ({ operation: taskOperation(op), error: op.lastError }));
}
export async function readTaskTransaction(tx: OfflineTransaction, account: string) {
  const base = await readTaskBase(tx, account);
  const changes = await readTaskChanges(tx, base);
  return { ...base, operations: changes.map(({ operation }) => operation) };
}
export async function prepareTaskRead(tx: OfflineTransaction, account: string) {
  const data = await readTaskTransaction(tx, account);
  const operations = classify(data.operations);
  if (
    operations.some(
      (op, index) => op.status !== data.operations[index]?.status || op.reason !== data.operations[index]?.reason,
    ) ||
    (operations.length && !(await usesOutbox(tx)))
  )
    await putTaskTransaction(tx, { ...data, operations });
}
export async function putTaskTransaction(tx: OfflineTransaction, input: TaskData) {
  const data = parse(input);
  checkSnapshotBudget('tasks', data, { budgetError: taskBudgetError });
  const existing = (await tx.readChanges()).filter((op) => op.module === 'tasks');
  const classified = classify(data.operations);
  await tx.removeChanges(
    new Set(
      existing.filter((old) => !classified.some((op) => op.id === old.operationId)).map((old) => old.operationId),
    ),
  );
  const previous = new Map<string, string>();
  const parents = new Map<string, string>();
  const previousTask = new Map<string, string>();
  for (const op of classified) {
    const key = `tasks:list:${op.listId}:task:${op.taskId}`;
    const keys = taskOrderingKeys(op);
    const old = existing.find((entry) => entry.operationId === op.id);
    if (old) {
      const updated: Operation = {
        ...old,
        submittedAt: op.submittedAt,
        payload: { listId: op.listId, taskId: op.taskId, change: op.change, occurrence: op.occurrence },
        ...(op.status === 'needs-review'
          ? { status: 'needs-review', ...(op.reason ? { reviewReason: op.reason } : {}) }
          : {}),
      };
      if (JSON.stringify(old) !== JSON.stringify(updated)) tx.replaceChange(updated);
    } else {
      await tx.appendChange('tasks', {
        operationId: op.id,
        submittedAt: op.submittedAt,
        entityId: op.taskId,
        orderingKeys: keys,
        payload: { listId: op.listId, taskId: op.taskId, change: op.change, occurrence: op.occurrence },
        dependsOn: [
          ...new Set([
            ...keys.flatMap((value) => (previous.has(value) ? [previous.get(value)!] : [])),
            ...(parents.has(key) ? [parents.get(key)!] : []),
            ...(op.occurrence && previousTask.has(key) ? [previousTask.get(key)!] : []),
          ]),
        ],
        ...(op.status === 'needs-review' ? { reviewReason: op.reason ?? 'expired' } : {}),
      });
    }
    keys.forEach((value) => previous.set(value, op.id));
    previousTask.set(key, op.id);
    if (op.change.type === 'create') parents.set(key, op.id);
  }
  // The outbox is the only durable journal after takeover. Cache holds only the base.
  await putTaskBaseTransaction(tx, data);
  data.operations = classified;
  return data;
}
export async function putTaskBaseTransaction(tx: OfflineTransaction, data: TaskData) {
  const queueBytes = (await tx.readChanges())
    .filter((op) => op.module === 'tasks')
    .reduce((sum, op) => sum + chargedBytes([data.account, op.operationId], op), 0);
  tx.commitSnapshot('tasks', parse({ ...data, operations: [] }), {
    maxBytes: taskCache.budget - queueBytes,
    queueBytes,
    engine: 'outbox',
    budgetError: 'Przekroczono budżet pamięci zadań. Zsynchronizuj zmiany lub zwolnij miejsce.',
  });
}
export async function readTaskData(account: string, token = accountToken()) {
  return withOfflineAccount('readonly', { account, token, current: () => isAccountCurrent(token) }, (tx) =>
    readTaskTransaction(tx, account),
  );
}
export async function updateTaskData(account: string, update: (data: TaskData) => void, token = accountToken()) {
  if (hasPendingClear()) throw new Error('Usuwanie danych konta nie zostało zakończone.');
  let changed = false;
  const result = await withOfflineAccount(
    'readwrite',
    { account, token, current: () => isAccountCurrent(token) },
    async (tx) => {
      const data = await readTaskTransaction(tx, account);
      const before = JSON.stringify(data);
      update(data);
      changed = before !== JSON.stringify(data);
      return putTaskTransaction(tx, data);
    },
  );
  try {
    if (changed) localStorage.setItem(TASK_SIGNAL, crypto.randomUUID());
  } catch {
    /* IDB is authoritative. */
  }
  return result;
}
