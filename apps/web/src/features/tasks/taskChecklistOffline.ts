import type { Task, TaskChecklistItem } from '@rodzina/shared';
import type { TaskOperation } from './taskSchemas.js';

export const unknownChecklistText = 'Połącz się z internetem, aby pobrać pełną checklistę zadania.';
export function checklistProgress(task: Task) {
  return task.checklist === undefined || task.checklistOrderVersion === undefined
    ? undefined
    : { done: task.checklist.filter((item) => item.isDone).length, total: task.checklist.length };
}
export function projectChecklist(task: Task, op: TaskOperation, actor: string, validate = true): Task {
  const change = op.change;
  if (!change.type.startsWith('checklist-')) return task;
  if (!task.checklist || task.checklistOrderVersion === undefined) throw new Error(unknownChecklistText);
  let items = [...task.checklist];
  let order = task.checklistOrderVersion;
  if (change.type === 'checklist-create') {
    if (!validate && items.some((item) => item.id === change.data.id)) return task;
    if (items.length >= 100 || items.some((item) => item.id === change.data.id))
      throw new Error('Nie można dodać kroku: limit lub powtórzony identyfikator.');
    items.push({
      ...change.data,
      taskId: task.id,
      position: items.length,
      isDone: false,
      doneBy: null,
      doneAt: null,
      version: 0,
      doneVersion: 0,
      createdBy: actor,
      createdAt: op.submittedAt,
      updatedAt: op.submittedAt,
    });
    order++;
  } else if (change.type === 'checklist-order') {
    if (
      (validate && change.data.orderVersion !== order) ||
      change.data.itemIds.length !== items.length ||
      items.some((item) => !change.data.itemIds.includes(item.id))
    )
      throw new Error('Kolejność checklisty wymaga sprawdzenia.');
    items = change.data.itemIds.map((id) => items.find((item) => item.id === id)!);
    order = change.data.orderVersion + 1;
  } else if (change.type === 'checklist-update' || change.type === 'checklist-remove') {
    const item = items.find((item) => item.id === change.itemId);
    if (!item) throw new Error('Krok zadania nie istnieje.');
    const data = change.data;
    if (
      validate &&
      (('version' in data && data.version !== item.version) ||
        ('doneVersion' in data && data.doneVersion !== item.doneVersion))
    )
      throw new Error('Krok checklisty wymaga sprawdzenia.');
    if (change.type === 'checklist-remove') {
      items = items.filter((item) => item.id !== change.itemId);
      order++;
    } else {
      const updated: TaskChecklistItem = { ...item, updatedAt: op.submittedAt };
      if ('title' in data) {
        updated.title = data.title;
        updated.version = data.version + 1;
      }
      if ('isDone' in data) {
        if (data.isDone !== item.isDone) {
          updated.doneBy = data.isDone ? actor : null;
          updated.doneAt = data.isDone ? op.submittedAt : null;
        }
        updated.isDone = data.isDone;
        updated.doneVersion = data.doneVersion + 1;
      }
      items = items.map((entry) => (entry.id === item.id ? updated : entry));
    }
  }
  return { ...task, checklist: items.map((item, position) => ({ ...item, position })), checklistOrderVersion: order };
}
