import { ApiError } from '../../http/errors.js';
import {
  expandOccurrences,
  hasEventOccurrence,
  splitEventRule,
  type CalendarEvent,
  type EventData,
  type EventPatch,
  type EventScope,
} from '@rodzina/shared';
import { eventDataSchema } from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { canEditEvent, type FamilyRole } from '../../permissions.js';
import { createEventRepository } from './repository.js';

export function createEventService(database: DatabaseConnection) {
  const repository = createEventRepository(database);
  function get(familyId: string, id: string): CalendarEvent {
    const event = repository.find(familyId, id);
    if (!event) throw new ApiError(404, 'NOT_FOUND', 'Nie znaleziono wydarzenia.');
    return event;
  }
  function checkParticipants(familyId: string, ids: string[]) {
    if (!repository.validParticipants(familyId, ids))
      throw new ApiError(400, 'VALIDATION_ERROR', 'Uczestnicy muszą należeć do Twojej rodziny.');
  }
  function checkEdit(event: CalendarEvent, actorId: string, role: FamilyRole) {
    if (!canEditEvent(role, actorId, event.createdBy))
      throw new ApiError(403, 'FORBIDDEN', 'Możesz zmieniać i usuwać tylko własne wydarzenia.');
  }
  function create(familyId: string, actorId: string, data: EventData) {
    checkParticipants(familyId, data.participantIds);
    return repository.create(familyId, actorId, data);
  }
  function checkScope(event: CalendarEvent, query: EventScope) {
    if (query.scope === 'all') return;
    if (event.kind !== 'recurring')
      throw new ApiError(400, 'VALIDATION_ERROR', 'Ten zakres dotyczy wyłącznie wydarzeń cyklicznych.');
    if (!query.occurrenceDate || !hasEventOccurrence(event, query.occurrenceDate))
      throw new ApiError(400, 'VALIDATION_ERROR', 'Podana data nie jest wystąpieniem tej serii.');
  }
  function update(
    familyId: string,
    id: string,
    actorId: string,
    role: FamilyRole,
    patch: EventPatch,
    query: EventScope = { scope: 'all' },
  ) {
    const event = get(familyId, id);
    checkEdit(event, actorId, role);
    checkScope(event, query);
    const date = query.occurrenceDate!;
    const exception = query.scope === 'this' ? event.exceptions.find((item) => item.originalDate === date) : undefined;
    if (
      query.scope === 'this' &&
      Object.keys(patch).some((key) => !['title', 'startDate', 'startTime', 'durationMinutes'].includes(key))
    )
      throw new ApiError(
        400,
        'VALIDATION_ERROR',
        'Pojedyncze wystąpienie pozwala zmienić tytuł, datę, godzinę i czas trwania.',
      );
    if (query.scope === 'following' && patch.kind !== undefined && patch.kind !== 'recurring')
      throw new ApiError(400, 'VALIDATION_ERROR', 'Nowa seria musi pozostać wydarzeniem cyklicznym.');
    const rules = query.scope === 'following' ? splitEventRule(event, date) : undefined;
    const parsed = eventDataSchema.safeParse({
      title: exception?.overrideTitle ?? event.title,
      description: event.description,
      location: event.location,
      startDate: query.scope === 'all' ? event.startDate : (exception?.overrideStartDate ?? date),
      startTime: exception && !exception.isCancelled ? exception.overrideStartTime : event.startTime,
      durationMinutes: exception && !exception.isCancelled ? exception.overrideDurationMinutes : event.durationMinutes,
      datePrecision: event.datePrecision,
      kind: event.kind,
      rrule: rules?.following ?? event.rrule,
      participantIds: event.participants.map((user) => user.id),
      ...patch,
    });
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Dane wydarzenia są niepoprawne.');
    checkParticipants(familyId, parsed.data.participantIds);
    if (query.scope === 'this') return repository.saveException(familyId, event, date, parsed.data);
    if (query.scope === 'following')
      return repository.split(familyId, event, date, rules!.previous, parsed.data, actorId)!;
    return repository.update(familyId, id, parsed.data, actorId);
  }
  function remove(
    familyId: string,
    id: string,
    actorId: string,
    role: FamilyRole,
    query: EventScope = { scope: 'all' },
  ) {
    const event = get(familyId, id);
    checkEdit(event, actorId, role);
    checkScope(event, query);
    if (query.scope === 'this') {
      repository.saveException(familyId, event, query.occurrenceDate!);
      return;
    }
    if (query.scope === 'following') {
      repository.split(familyId, event, query.occurrenceDate!, splitEventRule(event, query.occurrenceDate!).previous);
      return;
    }
    repository.remove(familyId, id);
  }
  function occurrences(familyId: string, from: string, to: string, userId?: string) {
    const tz = repository.timezone(familyId);
    return repository
      .list(familyId, userId)
      .flatMap((event) =>
        expandOccurrences(event, event.exceptions, from, to, tz).map((occurrence) => ({
          ...occurrence,
          title:
            event.exceptions.find((exception) => exception.originalDate === occurrence.occurrenceDate)?.overrideTitle ??
            event.title,
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
