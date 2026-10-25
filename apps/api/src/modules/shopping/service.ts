import { ApiError } from '../../http/errors.js';
import type { CreateShoppingItem, CreateShoppingList, PatchShoppingItem, PatchShoppingList } from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import type { FamilyRole } from '../../permissions.js';
import { createShoppingRepository } from './repository.js';

export function createShoppingService(database: DatabaseConnection) {
  const repository = createShoppingRepository(database);
  function getList(familyId: string, id: string) {
    const list = repository.findList(familyId, id);
    if (!list) throw new ApiError(404, 'NOT_FOUND', 'Lista zakupów nie istnieje.');
    return list;
  }
  function getItem(familyId: string, id: string) {
    const item = repository.findItem(familyId, id);
    if (!item) throw new ApiError(404, 'NOT_FOUND', 'Pozycja zakupów nie istnieje.');
    return item;
  }
  function requireAdult(role: FamilyRole) {
    if (role === 'child') throw new ApiError(403, 'FORBIDDEN', 'Ta czynność jest dostępna tylko dla dorosłych.');
  }
  function requireItemEdit(role: FamilyRole, actorId: string, createdBy: string | null) {
    if (role === 'child' && actorId !== createdBy)
      throw new ApiError(403, 'FORBIDDEN', 'Możesz edytować i usuwać tylko własne pozycje.');
  }
  return {
    listLists: repository.listLists,
    createList(familyId: string, actorId: string, role: FamilyRole, data: CreateShoppingList, id?: string) {
      requireAdult(role);
      return repository.createList(familyId, actorId, data, id);
    },
    updateList(familyId: string, id: string, role: FamilyRole, data: PatchShoppingList) {
      getList(familyId, id);
      requireAdult(role);
      const updated = repository.updateList(familyId, id, data);
      if (!updated) throw new ApiError(404, 'NOT_FOUND', 'Lista zakupów nie istnieje.');
      return updated;
    },
    removeList(familyId: string, id: string, role: FamilyRole) {
      getList(familyId, id);
      requireAdult(role);
      repository.removeList(familyId, id);
    },
    listItems(familyId: string, listId: string) {
      getList(familyId, listId);
      return repository.listItems(familyId, listId);
    },
    createItem(familyId: string, listId: string, actorId: string, data: CreateShoppingItem, id?: string) {
      getList(familyId, listId);
      const item = repository.createItem(familyId, listId, actorId, data, id);
      if (!item) throw new ApiError(404, 'NOT_FOUND', 'Lista zakupów nie istnieje.');
      return item;
    },
    updateItem(familyId: string, id: string, actorId: string, role: FamilyRole, data: PatchShoppingItem) {
      const item = getItem(familyId, id);
      if (Object.keys(data).some((key) => key !== 'isChecked')) requireItemEdit(role, actorId, item.createdBy);
      const updated = repository.updateItem(familyId, id, actorId, data);
      if (!updated) throw new ApiError(404, 'NOT_FOUND', 'Pozycja zakupów nie istnieje.');
      return updated;
    },
    removeItem(familyId: string, id: string, actorId: string, role: FamilyRole) {
      const item = getItem(familyId, id);
      requireItemEdit(role, actorId, item.createdBy);
      repository.removeItem(familyId, id);
    },
    clearChecked(familyId: string, listId: string, role: FamilyRole) {
      getList(familyId, listId);
      requireAdult(role);
      return repository.clearChecked(familyId, listId);
    },
    suggestions: repository.suggestions,
  };
}
