import type { CreateMyReminder } from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { createEventRepository } from '../events/repository.js';
import { EventError } from '../events/service.js';
import { createReminderRepository } from './repository.js';

export function createReminderService(database: DatabaseConnection) {
  const repository = createReminderRepository(database);
  const events = createEventRepository(database);
  function getSource(familyId: string, eventId: string) {
    const event = events.find(familyId, eventId);
    if (!event) throw new EventError(404, 'NOT_FOUND', 'Nie znaleziono wydarzenia.');
    return event;
  }
  function listMine(familyId: string, userId: string, eventId: string) {
    getSource(familyId, eventId);
    return repository.list(familyId, eventId, userId);
  }
  function createMine(familyId: string, userId: string, data: CreateMyReminder) {
    const event = getSource(familyId, data.eventId);
    return repository.insert(familyId, event, userId, data, 'user', events.timezone(familyId), Date.now(), userId);
  }
  function removeMine(familyId: string, userId: string, id: string) {
    if (!repository.removeMine(familyId, userId, id))
      throw new EventError(404, 'NOT_FOUND', 'Nie znaleziono przypomnienia.');
  }
  return { listMine, createMine, removeMine };
}
