import { expandOccurrences, type CalendarEvent, type EventData, type EventPatch } from '@rodzina/shared';
import { eventDataSchema } from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { canEditEvent, type FamilyRole } from '../../permissions.js';
import { createEventRepository } from './repository.js';

export class EventError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function createEventService(database: DatabaseConnection) {
  const repository = createEventRepository(database);
  function get(familyId: string, id: string): CalendarEvent {
    const event = repository.find(familyId, id);
    if (!event) throw new EventError(404, 'NOT_FOUND', 'Nie znaleziono wydarzenia.');
    return event;
  }
  function checkParticipants(familyId: string, ids: string[]) {
    if (!repository.validParticipants(familyId, ids))
      throw new EventError(400, 'VALIDATION_ERROR', 'Uczestnicy muszą należeć do Twojej rodziny.');
  }
  function checkEdit(event: CalendarEvent, actorId: string, role: FamilyRole) {
    if (!canEditEvent(role, actorId, event.createdBy))
      throw new EventError(403, 'FORBIDDEN', 'Możesz zmieniać i usuwać tylko własne wydarzenia.');
  }
  function create(familyId: string, actorId: string, data: EventData) {
    checkParticipants(familyId, data.participantIds);
    return repository.create(familyId, actorId, data);
  }
  function update(familyId: string, id: string, actorId: string, role: FamilyRole, patch: EventPatch) {
    const event = get(familyId, id);
    checkEdit(event, actorId, role);
    const parsed = eventDataSchema.safeParse({
      title: event.title,
      description: event.description,
      location: event.location,
      startDate: event.startDate,
      startTime: event.startTime,
      durationMinutes: event.durationMinutes,
      datePrecision: event.datePrecision,
      kind: event.kind,
      rrule: event.rrule,
      participantIds: event.participants.map((user) => user.id),
      ...patch,
    });
    if (!parsed.success) throw new EventError(400, 'VALIDATION_ERROR', 'Dane wydarzenia są niepoprawne.');
    checkParticipants(familyId, parsed.data.participantIds);
    return repository.update(familyId, id, parsed.data, actorId);
  }
  function remove(familyId: string, id: string, actorId: string, role: FamilyRole) {
    checkEdit(get(familyId, id), actorId, role);
    repository.remove(familyId, id);
  }
  function occurrences(familyId: string, from: string, to: string, userId?: string) {
    const tz = repository.timezone(familyId);
    return repository
      .list(familyId, userId)
      .flatMap((event) =>
        expandOccurrences(event, [], from, to, tz).map((occurrence) => ({
          ...occurrence,
          title: event.title,
          location: event.location,
          kind: event.kind,
          createdBy: event.createdBy,
          participants: event.participants,
        })),
      )
      .sort((a, b) => a.startUtc - b.startUtc || a.eventId.localeCompare(b.eventId));
  }
  function upcomingDistant(familyId: string) {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: repository.timezone(familyId),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(Date.now());
    return repository.upcomingDistant(familyId, today);
  }
  return { get, create, update, remove, occurrences, upcomingDistant };
}
