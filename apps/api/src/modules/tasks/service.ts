import type { CreateTask, CreateTaskList, PatchTask, PatchTaskList, TaskStatus } from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { createTaskListRepository } from './repository.js';
import { createReminderRepository } from '../reminders/repository.js';

export class TaskListError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function createTaskListService(database: DatabaseConnection) {
  const repository = createTaskListRepository(database);
  const reminders = createReminderRepository(database);
  const transaction = <T>(operation: () => T) => database.db.transaction(operation, { behavior: 'immediate' });
  function getList(familyId: string, actorId: string, id: string) {
    const list = repository.findAccessibleList(familyId, actorId, id);
    if (!list) throw new TaskListError(404, 'NOT_FOUND', 'Lista zadań nie istnieje.');
    return list;
  }
  function requireOwner(ownerId: string, actorId: string) {
    if (ownerId !== actorId)
      throw new TaskListError(403, 'FORBIDDEN', 'Tylko właściciel może zmieniać lub usuwać listę.');
  }
  function validateMembers(familyId: string, ownerId: string, memberIds: string[]) {
    const ids = [...new Set(memberIds)];
    if (!repository.areFamilyMembers(familyId, ids))
      throw new TaskListError(400, 'VALIDATION_ERROR', 'Listę można udostępnić tylko domownikom tej rodziny.');
    return ids.filter((id) => id !== ownerId);
  }
  function getTask(familyId: string, actorId: string, id: string) {
    const task = repository.findTask(familyId, actorId, id);
    if (!task) throw new TaskListError(404, 'NOT_FOUND', 'Zadanie nie istnieje.');
    return task;
  }
  function validateAssignee(list: { ownerId: string; memberIds: string[] }, assigneeId: string | null | undefined) {
    if (assigneeId && assigneeId !== list.ownerId && !list.memberIds.includes(assigneeId))
      throw new TaskListError(
        400,
        'VALIDATION_ERROR',
        'Zadanie można przypisać tylko właścicielowi lub członkowi listy.',
      );
  }
  return {
    listTasks(familyId: string, actorId: string, listId: string, status: TaskStatus) {
      getList(familyId, actorId, listId);
      return repository.listTasks(listId, status);
    },
    createTask(familyId: string, actorId: string, listId: string, data: CreateTask, id?: string) {
      return transaction(() => {
        const list = getList(familyId, actorId, listId);
        validateAssignee(list, data.assigneeId);
        if (data.reminders?.length && !data.dueDate)
          throw new TaskListError(400, 'VALIDATION_ERROR', 'Przypomnienie wymaga daty terminu zadania.');
        const { reminders: shared, ...fields } = data;
        const task = repository.createTask(listId, actorId, fields, id);
        reminders.saveTask(familyId, task, actorId, shared, repository.timezone(familyId), Date.now());
        return { ...task, reminders: reminders.listTask(familyId, task.id) };
      });
    },
    updateTask(familyId: string, actorId: string, id: string, data: PatchTask) {
      return transaction(() => {
        const task = getTask(familyId, actorId, id);
        const list = getList(familyId, actorId, task.listId);
        const merged = { ...task, ...data };
        validateAssignee(list, merged.assigneeId);
        if (merged.dueTime && !merged.dueDate)
          throw new TaskListError(400, 'VALIDATION_ERROR', 'Godzina wymaga daty terminu.');
        if (data.reminders?.length && !merged.dueDate)
          throw new TaskListError(400, 'VALIDATION_ERROR', 'Przypomnienie wymaga daty terminu zadania.');
        const { reminders: shared, ...fields } = data;
        const updated = repository.updateTask(task, actorId, fields);
        reminders.saveTask(familyId, updated, actorId, shared, repository.timezone(familyId), Date.now());
        return { ...updated, reminders: reminders.listTask(familyId, task.id) };
      });
    },
    removeTask(familyId: string, actorId: string, id: string) {
      transaction(() => {
        getTask(familyId, actorId, id);
        repository.removeTask(id);
      });
    },
    todayTasks(familyId: string, actorId: string) {
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: repository.timezone(familyId),
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(Date.now());
      return repository.todayTasks(familyId, actorId, today);
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
        return repository.updateList(id, data.name, memberIds);
      });
    },
    removeList(familyId: string, actorId: string, id: string) {
      transaction(() => {
        const list = getList(familyId, actorId, id);
        requireOwner(list.ownerId, actorId);
        if (list.isDefault) throw new TaskListError(400, 'DEFAULT_LIST', 'Nie można usunąć domyślnej listy zadań.');
        repository.removeList(id);
      });
    },
    leaveList(familyId: string, actorId: string, id: string) {
      transaction(() => {
        const list = getList(familyId, actorId, id);
        if (list.ownerId === actorId)
          throw new TaskListError(403, 'FORBIDDEN', 'Właściciel nie może opuścić swojej listy.');
        repository.updateList(
          id,
          undefined,
          list.memberIds.filter((userId) => userId !== actorId),
        );
      });
    },
    prepareMemberRemoval: repository.prepareMemberRemoval,
  };
}
