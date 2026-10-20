import type { CreateTaskList, PatchTaskList } from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { createTaskListRepository } from './repository.js';

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
  return {
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
