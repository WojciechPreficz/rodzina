import { z } from 'zod';
import { operationSchema, snapshotSchema, discardSchema, classify, TASK_STORAGE_KEY } from './taskSchemas.js';
import { registerAdapter, chargedBytes, type CacheEntry } from '../../offline/registry.js';
import { registerRecordMigration } from '../../offline/recordMigration.js';
import { accountToken, assertContext, transact, requestValue, CLEAR_PENDING_KEY } from '../../offline/database.js';
const dataSchema = z.object({
  version: z.literal(1),
  account: z.string().min(1),
  snapshot: snapshotSchema,
  operations: z.array(operationSchema),
  discards: z.record(discardSchema),
});
export type TaskData = z.infer<typeof dataSchema>;
export const TASK_SIGNAL = 'offline-tasks-changed:1';
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
        tasks.some((task) => task.listId !== id),
    ) ||
    new Set(data.operations.map((op) => op.id)).size !== data.operations.length
  )
    throw new Error('Nieprawidłowe konto lub powiązania zapisanych zadań.');
  const discarded = new Set(Object.values(data.discards).flatMap((entry) => entry.operationIds));
  data.operations = data.operations.filter((op) => !discarded.has(op.id));
  return data;
}
function entry(input: unknown): CacheEntry {
  const data = parse(input);
  const result: CacheEntry = {
    accountId: data.account,
    module: 'tasks',
    key: 'snapshot',
    schemaVersion: 1,
    payload: data,
    syncedAt: data.snapshot.syncedAt ?? null,
    coverage: data.snapshot.lists ? 'partial' : 'missing',
    usedAt: Date.now(),
    chargedBytes: 0,
  };
  const key = [data.account, 'tasks', 'snapshot'];
  while (result.chargedBytes !== chargedBytes(key, result)) result.chargedBytes = chargedBytes(key, result);
  // Pending/review operations and refresh tombstones pin the confirmed base.
  // Refuse oversized changes rather than silently dropping any offline work.
  if (result.chargedBytes > 6 * 1048576)
    throw new Error('Nie można zapisać zadań: przekroczono budżet pamięci. Zsynchronizuj zmiany lub zwolnij miejsce.');
  return result;
}
function put(tx: IDBTransaction, value: unknown) {
  const record = entry(value);
  tx.objectStore('cache').put(record);
  tx.objectStore('metadata').put({ accountId: record.accountId, key: 'engine:tasks', value: 'legacy-idb' });
  tx.objectStore('metadata').put({ accountId: record.accountId, key: 'budget:tasks', value: record.chargedBytes });
}
registerAdapter({
  module: 'tasks',
  schemaVersion: 1,
  capabilities: 'read-write',
  separateMigration: true,
  legacyKey: TASK_STORAGE_KEY,
  budget: 6 * 1048576,
  parseCache: parse,
  trim: (value) => value,
  describe: (value) => ({ syncedAt: parse(value).snapshot.syncedAt ?? null, coverage: 'partial' }),
});
export function importTasks(source: Record<string, string>, active?: string): TaskData {
  const snapshot = source[TASK_STORAGE_KEY] ? snapshotSchema.parse(JSON.parse(source[TASK_STORAGE_KEY]!)) : undefined;
  const accounts = Object.keys(source)
    .filter((key) => key !== TASK_STORAGE_KEY)
    .map((key) => key.slice(`${TASK_STORAGE_KEY}:`.length).split(':').slice(1, 3).join(':'));
  const account = snapshot?.account ?? active ?? accounts[0];
  if (!account || accounts.some((value) => value !== account) || (active && active !== account))
    throw new Error('Dziennik zadań należy do innego konta.');
  const data: TaskData = {
    version: 1,
    account,
    snapshot: snapshot ?? { account, items: {} },
    operations: [],
    discards: {},
  };
  for (const [key, raw] of Object.entries(source)) {
    if (key === TASK_STORAGE_KEY) continue;
    if (key.startsWith(`${TASK_STORAGE_KEY}:operation:${account}:`)) {
      const op = operationSchema.parse(JSON.parse(raw));
      if (key !== `${TASK_STORAGE_KEY}:operation:${account}:${op.id}`)
        throw new Error('Nieprawidłowy klucz operacji zadania.');
      data.operations.push(op);
    } else if (key.startsWith(`${TASK_STORAGE_KEY}:discard:${account}:`)) {
      data.discards[key.slice(`${TASK_STORAGE_KEY}:discard:${account}:`.length)] = discardSchema.parse(JSON.parse(raw));
    } else throw new Error('Nieobsługiwany format dziennika zadań.');
  }
  data.operations.sort((a, b) => a.submittedAt - b.submittedAt || a.id.localeCompare(b.id));
  const validated = parse(data);
  validated.operations = classify(validated.operations);
  entry(validated);
  return validated;
}
registerRecordMigration('tasks', TASK_STORAGE_KEY, importTasks, put);
export async function readTaskData(account: string) {
  return transact('readonly', async (tx) => {
    const active = await assertContext(tx);
    if (active.accountId !== account) throw new DOMException('Session changed', 'AbortError');
    const record = await requestValue<CacheEntry | undefined>(
      tx.objectStore('cache').get([account, 'tasks', 'snapshot']),
    );
    if (!record) return;
    if (record.schemaVersion !== 1) throw new Error('Nieobsługiwana wersja pamięci zadań.');
    return parse(record.payload);
  });
}
export async function updateTaskData(account: string, update: (data: TaskData) => void, token = accountToken()) {
  if (localStorage.getItem(CLEAR_PENDING_KEY)) throw new Error('Usuwanie danych konta nie zostało zakończone.');
  let changed = false;
  const result = await transact(
    'readwrite',
    async (tx) => {
      const active = await assertContext(tx);
      if (active.accountId !== account) throw new DOMException('Session changed', 'AbortError');
      const record = await requestValue<CacheEntry | undefined>(
        tx.objectStore('cache').get([account, 'tasks', 'snapshot']),
      );
      if (record && record.schemaVersion !== 1) throw new Error('Nieobsługiwana wersja pamięci zadań.');
      const data = record
        ? parse(record.payload)
        : { version: 1 as const, account, snapshot: { account, items: {} }, operations: [], discards: {} };
      if (data.account !== account) throw new DOMException('Session changed', 'AbortError');
      const before = record ? JSON.stringify(record.payload) : undefined;
      update(data);
      changed = before !== JSON.stringify(data);
      if (changed) put(tx, data);
      return data;
    },
    token,
  );
  try {
    if (changed) localStorage.setItem(TASK_SIGNAL, crypto.randomUUID());
  } catch {
    /* IDB is authoritative. */
  }
  return result;
}
export async function clearTaskData(account: string) {
  await transact('readwrite', async (tx) => {
    const active = await assertContext(tx);
    if (active.accountId !== account) return;
    tx.objectStore('cache').delete([account, 'tasks', 'snapshot']);
    tx.objectStore('metadata').delete([account, 'budget:tasks']);
  });
}
