import type {
  CreateTaskChecklistItem,
  PatchTaskChecklistItem,
  DeleteTaskChecklistItem,
  ReorderTaskChecklist,
} from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { ApiError } from '../../http/errors.js';
import { createTaskListRepository } from './repository.js';
import { bumpTaskOccurrence } from './recurrence-repository.js';

export function createTaskChecklistService(database: DatabaseConnection) {
  const repository = createTaskListRepository(database);
  const db = database.db;
  function parent(familyId: string, actorId: string, taskId: string) {
    const task = repository.findTask(familyId, actorId, taskId);
    if (!task) throw new ApiError(404, 'NOT_FOUND', 'Zadanie nie istnieje.');
    return task;
  }
  function read(familyId: string, actorId: string, taskId: string) {
    const task = parent(familyId, actorId, taskId);
    return {
      ok: true as const,
      items: repository.checklistMany([taskId]).get(taskId) ?? [],
      orderVersion: task.checklistOrderVersion,
    };
  }
  function conflict() {
    throw new ApiError(
      409,
      'CHECKLIST_CONFLICT',
      'Checklista została zmieniona. Pobierz aktualne dane i sprawdź zmianę.',
    );
  }
  return {
    parent,
    read,
    create(familyId: string, actorId: string, taskId: string, data: CreateTaskChecklistItem) {
      return db.transaction(
        () => {
          const current = read(familyId, actorId, taskId);
          if (current.items.length >= 100)
            throw new ApiError(400, 'CHECKLIST_LIMIT', 'Zadanie może mieć najwyżej 100 kroków.');
          const now = Date.now();
          repository.insertChecklistItem({
            ...data,
            taskId,
            position: current.items.length,
            createdBy: actorId,
            createdAt: now,
            updatedAt: now,
          });
          repository.bumpChecklistOrder(familyId, taskId);
          bumpTaskOccurrence(database, familyId, taskId);
          return read(familyId, actorId, taskId);
        },
        { behavior: 'immediate' },
      );
    },
    change(
      familyId: string,
      actorId: string,
      taskId: string,
      itemId: string,
      data: PatchTaskChecklistItem | DeleteTaskChecklistItem,
      remove = false,
    ) {
      return db.transaction(
        () => {
          const current = read(familyId, actorId, taskId);
          const item = current.items.find((item) => item.id === itemId);
          if (!item) throw new ApiError(404, 'NOT_FOUND', 'Krok zadania nie istnieje.');
          if ('version' in data && data.version !== item.version) conflict();
          if ('doneVersion' in data && data.doneVersion !== item.doneVersion) conflict();
          if (remove) {
            repository.removeChecklistItem(familyId, taskId, itemId);
            for (const row of current.items.filter((row) => row.position > item.position))
              repository.updateChecklistItem(familyId, taskId, row.id, { position: row.position - 1 });
            repository.bumpChecklistOrder(familyId, taskId);
          } else if ('title' in data) {
            repository.updateChecklistItem(familyId, taskId, itemId, {
              title: data.title,
              version: item.version + 1,
              updatedAt: Date.now(),
            });
          } else if ('isDone' in data) {
            const now = Date.now();
            const completion =
              data.isDone === item.isDone
                ? {}
                : { doneBy: data.isDone ? actorId : null, doneAt: data.isDone ? now : null };
            repository.updateChecklistItem(familyId, taskId, itemId, {
              isDone: data.isDone,
              ...completion,
              doneVersion: item.doneVersion + 1,
              updatedAt: now,
            });
          }
          bumpTaskOccurrence(database, familyId, taskId);
          return read(familyId, actorId, taskId);
        },
        { behavior: 'immediate' },
      );
    },
    reorder(familyId: string, actorId: string, taskId: string, data: ReorderTaskChecklist) {
      return db.transaction(
        () => {
          const current = read(familyId, actorId, taskId);
          if (current.orderVersion !== data.orderVersion) conflict();
          if (
            current.items.length !== data.itemIds.length ||
            current.items.some((item) => !data.itemIds.includes(item.id))
          )
            throw new ApiError(
              400,
              'VALIDATION_ERROR',
              'Kolejność musi zawierać wszystkie aktualne kroki tego zadania.',
            );
          data.itemIds.forEach((id, position) => repository.updateChecklistItem(familyId, taskId, id, { position }));
          repository.bumpChecklistOrder(familyId, taskId);
          bumpTaskOccurrence(database, familyId, taskId);
          return read(familyId, actorId, taskId);
        },
        { behavior: 'immediate' },
      );
    },
  };
}
