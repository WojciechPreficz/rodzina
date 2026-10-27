import { assertContext, requestValue } from './database.js';
import { adapters, chargedBytes, type CacheEntry } from './registry.js';
import { z } from 'zod';

export type Operation = {
  schemaVersion: 1;
  payloadVersion: 1;
  accountId: string;
  operationId: string;
  module: string;
  entityId: string;
  orderingKeys: string[];
  sequence: number;
  submittedAt: number;
  payload: unknown;
  dependsOn: string[];
  status: 'pending' | 'sending' | 'retry-wait' | 'needs-review';
  attempts: number;
  nextAttemptAt: number;
  lastError?: string;
  reviewReason?: string;
};
export type Intent = Pick<Operation, 'operationId' | 'submittedAt' | 'payload' | 'entityId' | 'orderingKeys'> & {
  dependsOn?: string[];
  reviewReason?: string;
};
const operationSchema = z.object({
  schemaVersion: z.literal(1),
  payloadVersion: z.literal(1),
  accountId: z.string().min(1),
  operationId: z.string().min(1),
  module: z.string().min(1),
  entityId: z.string().min(1),
  orderingKeys: z.array(z.string().min(1)).min(1),
  sequence: z.number().int().safe().positive(),
  submittedAt: z.number().finite().positive(),
  payload: z.unknown(),
  dependsOn: z.array(z.string().min(1)),
  status: z.enum(['pending', 'sending', 'retry-wait', 'needs-review']),
  attempts: z.number().int().nonnegative(),
  nextAttemptAt: z.number().finite().nonnegative(),
  lastError: z.string().optional(),
  reviewReason: z.string().optional(),
});
export async function readOperations(tx: IDBTransaction, accountId: string): Promise<Operation[]> {
  const operations = await requestValue<Operation[]>(tx.objectStore('outbox').index('accountId').getAll(accountId));
  if (operations.some((op) => op.schemaVersion !== 1 || op.payloadVersion !== 1))
    throw new Error('Nieobsługiwana wersja kolejki offline. Zaktualizuj aplikację.');
  for (const operation of operations) operationSchema.parse(operation);
  return operations.sort((a, b) => a.sequence - b.sequence);
}
export async function appendOperation(tx: IDBTransaction, accountId: string, module: string, intent: Intent) {
  const active = await assertContext(tx);
  if (active.accountId !== accountId) throw new DOMException('Session changed', 'AbortError');
  const operations = await readOperations(tx, accountId);
  if (operations.some((op) => op.operationId === intent.operationId))
    throw new Error('Ta operacja jest już zapisana w kolejce.');
  const dependsOn = intent.dependsOn ?? [];
  // Only existing parents are accepted. This also prevents cycles and self-dependencies.
  if (dependsOn.some((id) => !operations.some((op) => op.operationId === id)))
    throw new Error('Nieprawidłowa zależność operacji offline.');
  const metadata = tx.objectStore('metadata');
  const counter = await requestValue<{ value: number } | undefined>(metadata.get([accountId, 'outbox-sequence']));
  const sequence = Math.max(counter?.value ?? 0, ...operations.map((op) => op.sequence), 0) + 1;
  if (!Number.isSafeInteger(sequence)) throw new Error('Przekroczono zakres kolejności operacji offline.');
  const operation: Operation = {
    ...intent,
    schemaVersion: 1,
    payloadVersion: 1,
    accountId,
    module,
    sequence,
    dependsOn,
    status: intent.reviewReason ? 'needs-review' : 'pending',
    attempts: 0,
    nextAttemptAt: 0,
  };
  operationSchema.parse(operation);
  const size = [...operations, operation]
    .filter((op) => op.module === module)
    .reduce((sum, op) => sum + chargedBytes([accountId, op.operationId], op), 0);
  if (size > 6 * 1048576) throw new Error('Brak miejsca w kolejce offline. Zsynchronizuj zapisane zmiany.');
  tx.objectStore('outbox').add(operation);
  metadata.put({ accountId, key: 'outbox-sequence', value: sequence });
  return operation;
}
export function nextOperation(
  operations: Operation[],
  now: number,
  available: (op: Operation) => boolean = () => true,
) {
  return operations.find(
    (op, index) =>
      available(op) &&
      op.status !== 'needs-review' &&
      op.nextAttemptAt <= now &&
      !op.dependsOn.length &&
      !operations.slice(0, index).some((parent) => parent.orderingKeys.some((key) => op.orderingKeys.includes(key))),
  );
}
export function completeOperation(tx: IDBTransaction, operations: Operation[], operation: Operation) {
  const store = tx.objectStore('outbox');
  store.delete([operation.accountId, operation.operationId]);
  for (const child of operations)
    if (child.dependsOn.includes(operation.operationId))
      store.put({ ...child, dependsOn: child.dependsOn.filter((id) => id !== operation.operationId) });
}

// Retry/review and dependency updates change envelope sizes without a base write.
// Recount after those transitions as well as after removing a completed operation.
export async function recountOutboxBudgets(tx: IDBTransaction, accountId: string) {
  const operations = await readOperations(tx, accountId);
  const cache = tx.objectStore('cache');
  const records = await requestValue<CacheEntry[]>(cache.index('accountId').getAll(accountId));
  for (const record of records) {
    if (adapters.get(record.module)?.capabilities !== 'read-write') continue;
    const key = [accountId, record.module, record.key];
    const previous = record.chargedBytes;
    while (record.chargedBytes !== chargedBytes(key, record)) record.chargedBytes = chargedBytes(key, record);
    if (previous !== record.chargedBytes) cache.put(record);
    const queueBytes = operations
      .filter((op) => op.module === record.module)
      .reduce((sum, op) => sum + chargedBytes([accountId, op.operationId], op), 0);
    tx.objectStore('metadata').put({
      accountId,
      key: `budget:${record.module}`,
      value: record.chargedBytes + queueBytes,
    });
  }
}

export type Lease = { owner: string; epoch: number; expiresAt: number; generation: string };
export async function acquireLease(tx: IDBTransaction, accountId: string, owner: string, now: number) {
  const active = await assertContext(tx);
  if (active.accountId !== accountId) throw new DOMException('Session changed', 'AbortError');
  const store = tx.objectStore('metadata');
  const old = (await requestValue<{ value: Lease } | undefined>(store.get([accountId, 'sender-lease'])))?.value;
  if (old && old.owner !== owner && old.expiresAt > now && old.generation === active.generation) return;
  const value: Lease = {
    owner,
    epoch: (old?.epoch ?? 0) + (old?.owner === owner && old.expiresAt > now ? 0 : 1),
    expiresAt: now + 15000,
    generation: active.generation,
  };
  store.put({ accountId, key: 'sender-lease', value });
  return value;
}
export async function assertLease(tx: IDBTransaction, accountId: string, expected: Lease, now: number) {
  const active = await assertContext(tx);
  const lease = (
    await requestValue<{ value: Lease } | undefined>(tx.objectStore('metadata').get([accountId, 'sender-lease']))
  )?.value;
  if (
    active.accountId !== accountId ||
    !lease ||
    lease.owner !== expected.owner ||
    lease.epoch !== expected.epoch ||
    lease.expiresAt <= now ||
    lease.generation !== active.generation
  )
    throw new DOMException('Sender lease lost', 'AbortError');
  return lease;
}
