import { checkSnapshotBudget, createRecordRecovery } from '../../offline/index.js';
import { classify, discardSchema, operationSchema, snapshotSchema, TASK_STORAGE_KEY } from './taskSchemas.js';
import { taskBudgetError, taskCache, type TaskData } from './taskStorage.js';

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
  const validated = taskCache.parseCache(data);
  validated.operations = classify(validated.operations);
  return validated;
}
export const recoverTasks = createRecordRecovery(
  'tasks',
  TASK_STORAGE_KEY,
  (source, account) => {
    const data = importTasks(source, account);
    checkSnapshotBudget('tasks', data, { budgetError: taskBudgetError });
    return data;
  },
  (tx, value) =>
    tx.commitSnapshot('tasks', taskCache.parseCache(value), { engine: 'legacy-idb', budgetError: taskBudgetError }),
);
