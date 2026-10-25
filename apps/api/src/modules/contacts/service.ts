import type { CreateContact, PatchContact } from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import type { FamilyRole } from '../../permissions.js';
import { ApiError } from '../../http/errors.js';
import { createContactRepository } from './repository.js';

export function createContactService(database: DatabaseConnection) {
  const repository = createContactRepository(database);
  function requireAdult(role: FamilyRole) {
    if (role === 'child') throw new ApiError(403, 'FORBIDDEN', 'Ta czynność jest dostępna tylko dla dorosłych.');
  }
  function find(familyId: string, id: string) {
    const contact = repository.find(familyId, id);
    if (!contact) throw new ApiError(404, 'NOT_FOUND', 'Kontakt nie istnieje.');
    return contact;
  }
  function findGroup(familyId: string, id: string) {
    const group = repository.findGroup(familyId, id);
    if (!group) throw new ApiError(404, 'NOT_FOUND', 'Grupa kontaktów nie istnieje.');
    return group;
  }
  function defaultGroup(familyId: string) {
    const group = repository.defaultGroup(familyId);
    if (!group) throw new ApiError(500, 'INTERNAL_ERROR', 'Brak domyślnej grupy kontaktów.');
    return group;
  }
  return {
    snapshot: repository.snapshot,
    create(familyId: string, actorId: string, role: FamilyRole, data: CreateContact) {
      requireAdult(role);
      return database.db.transaction(() => {
        const groupId = data.groupId ?? defaultGroup(familyId).id;
        findGroup(familyId, groupId);
        return repository.create(familyId, actorId, { ...data, groupId });
      });
    },
    update(familyId: string, id: string, role: FamilyRole, data: PatchContact) {
      requireAdult(role);
      return database.db.transaction(() => {
        find(familyId, id);
        if (data.groupId !== undefined) findGroup(familyId, data.groupId);
        return repository.update(familyId, id, data)!;
      });
    },
    remove(familyId: string, id: string, role: FamilyRole) {
      requireAdult(role);
      find(familyId, id);
      repository.remove(familyId, id);
    },
    createGroup(familyId: string, actorId: string, role: FamilyRole, name: string) {
      requireAdult(role);
      return repository.createGroup(familyId, actorId, name);
    },
    updateGroup(familyId: string, id: string, role: FamilyRole, name: string) {
      requireAdult(role);
      findGroup(familyId, id);
      return repository.updateGroup(familyId, id, name)!;
    },
    removeGroup(familyId: string, id: string, role: FamilyRole) {
      requireAdult(role);
      database.db.transaction(() => {
        const group = findGroup(familyId, id);
        if (group.isDefault) throw new ApiError(409, 'CONFLICT', 'Nie można usunąć domyślnej grupy kontaktów.');
        repository.removeGroup(familyId, id, defaultGroup(familyId).id);
      });
    },
  };
}
