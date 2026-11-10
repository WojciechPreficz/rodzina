import { createFamilyReader } from '../family/reader.js';
import { formatLocalDate } from '../../http/local-date.js';
import { bumpTaskOccurrence } from './recurrence-repository.js';
import { ApiError } from '../../http/errors.js';
import type { CreateTask, CreateTaskList, PatchTask, PatchTaskList, TaskStatus } from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { createTaskListRepository } from './repository.js';
import { createReminderSourcePort } from '../reminders/source-port.js';
import { createTaskRecurrenceService } from './recurrence.js';

export function createTaskListService(database: DatabaseConnection) {
  const repository = createTaskListRepository(database);
  const { timezone } = createFamilyReader(database);
  const reminders = createReminderSourcePort(database);
  const recurrence = createTaskRecurrenceService(database);
  const transaction = <T>(operation: () => T) => database.db.transaction(operation, { behavior: 'immediate' });
  function getList(familyId: string, actorId: string, id: string) {
    const list = repository.findAccessibleList(familyId, actorId, id);
    if (!list) throw new ApiError(404, 'NOT_FOUND', 'Lista zadań nie istnieje.');
    return list;
  }
  function requireOwner(ownerId: string, actorId: string) {
    if (ownerId !== actorId) throw new ApiError(403, 'FORBIDDEN', 'Tylko właściciel może zmieniać lub usuwać listę.');
  }
  function validateMembers(familyId: string, ownerId: string, memberIds: string[]) {
    const ids = [...new Set(memberIds)];
    if (!repository.areFamilyMembers(familyId, ids))
      throw new ApiError(400, 'VALIDATION_ERROR', 'Listę można udostępnić tylko domownikom tej rodziny.');
    return ids.filter((id) => id !== ownerId);
  }
  function getTask(familyId: string, actorId: string, id: string) {
    const task = repository.findTask(familyId, actorId, id);
    if (!task) throw new ApiError(404, 'NOT_FOUND', 'Zadanie nie istnieje.');
    return task;
  }
  function validateAssignee(list: { ownerId: string; memberIds: string[] }, assigneeId: string | null | undefined) {
    if (assigneeId && assigneeId !== list.ownerId && !list.memberIds.includes(assigneeId))
      throw new ApiError(400, 'VALIDATION_ERROR', 'Zadanie można przypisać tylko właścicielowi lub członkowi listy.');
  }
  function sharedReminders(familyId: string, tasks: { id: string }[]) {
    return reminders.listMany(
      familyId,
      'taskId',
      tasks.map((task) => task.id),
    );
  }
  function withReminders<T extends { id: string }>(familyId: string, tasks: T[]) {
    const shared = sharedReminders(familyId, tasks);
    return tasks.map((task) => ({ ...task, reminders: shared.get(task.id) ?? [] }));
  }
  return {
    findTask: repository.findTask,
    bumpOccurrenceVersion: (familyId: string, id: string) => bumpTaskOccurrence(database, familyId, id),
    snapshot(familyId: string, actorId: string) {
      return database.db.transaction(() => {
        const snapshot = repository.snapshot(familyId, actorId);
        const shared = sharedReminders(familyId, Object.values(snapshot.items).flat());
        const items = Object.fromEntries(
          Object.entries(snapshot.items).map(([id, tasks]) => [
            id,
            tasks.map((task) => ({ ...task, reminders: shared.get(task.id) ?? [] })),
          ]),
        );
        return { ...snapshot, items };
      });
    },
    ensureDefault: repository.ensureDefault,
    listTasks(familyId: string, actorId: string, listId: string, status: TaskStatus) {
      getList(familyId, actorId, listId);
      return withReminders(familyId, repository.listTasks(listId, status));
    },
    createTask(familyId: string, actorId: string, listId: string, data: CreateTask, id?: string) {
      return transaction(() => {
        const list = getList(familyId, actorId, listId);
        validateAssignee(list, data.assigneeId);
        if (data.reminders?.length && !data.dueDate)
          throw new ApiError(400, 'VALIDATION_ERROR', 'Przypomnienie wymaga daty terminu zadania.');
        const { reminders: shared, ...fields } = data;
        const task = repository.createTask(familyId, listId, actorId, fields, id);
        reminders.saveTask(familyId, task, actorId, shared, timezone(familyId), Date.now());
        return { ...task, recurrence: null, checklist: [], reminders: reminders.listTask(familyId, task.id) };
      });
    },
    updateTask(familyId: string, actorId: string, id: string, data: PatchTask) {
      return transaction(() => {
        const task = getTask(familyId, actorId, id);
        const list = getList(familyId, actorId, task.listId);
        const merged = { ...task, ...data };
        validateAssignee(list, merged.assigneeId);
        if (merged.dueTime && !merged.dueDate)
          throw new ApiError(400, 'VALIDATION_ERROR', 'Godzina wymaga daty terminu.');
        if (data.reminders?.length && !merged.dueDate)
          throw new ApiError(400, 'VALIDATION_ERROR', 'Przypomnienie wymaga daty terminu zadania.');
        const { reminders: shared, ...fields } = data;
        delete fields.closedAt;
        delete fields.expectedOccurrenceVersion;
        delete fields.expectedSeriesVersion;
        delete fields.expectedSeriesId;
        const updated = repository.updateTask(familyId, task, actorId, fields);
        recurrence.patch(familyId, actorId, task, updated, data);
        const finalTask = getTask(familyId, actorId, id);
        reminders.saveTask(familyId, finalTask, actorId, shared, timezone(familyId), Date.now());
        return {
          ...finalTask,
          recurrence: recurrence.occurrence(id) ?? null,
          checklist: repository.checklistMany([task.id]).get(task.id) ?? [],
          reminders: reminders.listTask(familyId, task.id),
        };
      });
    },
    removeTask(familyId: string, actorId: string, id: string) {
      transaction(() => {
        const task = getTask(familyId, actorId, id);
        recurrence.beforeDelete(familyId, actorId, task);
        repository.removeTask(familyId, id);
      });
    },
    todayTasks(familyId: string, actorId: string) {
      const today = formatLocalDate(Date.now(), timezone(familyId));
      return withReminders(familyId, repository.todayTasks(familyId, actorId, today));
    },
    canAccessList(familyId: string, actorId: string, id: string) {
      return !!repository.findAccessibleList(familyId, actorId, id);
    },
    listLists(familyId: string, actorId: string) {
      return transaction(() => {
        repository.ensureDefault(familyId, actorId);
        return repository.listLists(familyId, actorId);
      });
    },
    createList(familyId: string, actorId: string, data: CreateTaskList) {
      return transaction(() => {
        const memberIds = validateMembers(familyId, actorId, data.memberIds ?? []);
        repository.ensureDefault(familyId, actorId);
        return repository.createList(familyId, actorId, data.name, memberIds);
      });
    },
    updateList(familyId: string, actorId: string, id: string, data: PatchTaskList) {
      return transaction(() => {
        const list = getList(familyId, actorId, id);
        requireOwner(list.ownerId, actorId);
        const memberIds = data.memberIds === undefined ? undefined : validateMembers(familyId, actorId, data.memberIds);
        return repository.updateList(familyId, id, data.name, memberIds)!;
      });
    },
    removeList(familyId: string, actorId: string, id: string) {
      transaction(() => {
        const list = getList(familyId, actorId, id);
        requireOwner(list.ownerId, actorId);
        if (list.isDefault) throw new ApiError(400, 'DEFAULT_LIST', 'Nie można usunąć domyślnej listy zadań.');
        repository.removeList(familyId, id);
      });
    },
    leaveList(familyId: string, actorId: string, id: string) {
      transaction(() => {
        const list = getList(familyId, actorId, id);
        if (list.ownerId === actorId) throw new ApiError(403, 'FORBIDDEN', 'Właściciel nie może opuścić swojej listy.');
        repository.updateList(
          familyId,
          id,
          undefined,
          list.memberIds.filter((userId) => userId !== actorId),
        );
      });
    },
    prepareMemberRemoval: repository.prepareMemberRemoval,
  };
}
