import { createFamilyReader } from '../family/reader.js';
import { createReminderSourcePort } from '../reminders/source-port.js';
import { formatLocalDate } from '../../http/local-date.js';
import { createHash } from 'node:crypto';
import { ApiError } from '../../http/errors.js';
import {
  expandOccurrences,
  hasEventOccurrence,
  splitEventRule,
  type CalendarEvent,
  type EventData,
  type EventPatch,
  type EventScope,
  type EventDuplicate,
  type EventDuplicateResolution,
} from '@rodzina/shared';
import { eventDataSchema, importEventSchema, type ImportEvents, type ImportEventResult } from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { canEditEvent, type FamilyRole } from '../../permissions.js';
import { createEventRepository } from './repository.js';

class DuplicateEventError extends ApiError {
  constructor(
    public duplicates: EventDuplicate[],
    message = 'W tym dniu jest już wydarzenie o takim tytule. Wybierz zastąpienie lub dodanie kolejnego.',
  ) {
    super(409, 'DUPLICATE_EVENT', message);
  }
}
const normalizeTitle = (title: string) =>
  title.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('pl-PL');
const eventVersion = (event: CalendarEvent) => createHash('sha256').update(JSON.stringify(event)).digest('hex');

export function createEventService(database: DatabaseConnection) {
  const { timezone } = createFamilyReader(database);
  const repository = createEventRepository(database, createReminderSourcePort(database), timezone);
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
  function duplicates(
    familyId: string,
    actorId: string,
    role: FamilyRole,
    title: string,
    startDate: string,
    kind: EventData['kind'],
  ) {
    const tz = timezone(familyId);
    return repository.list(familyId).flatMap((event): EventDuplicate[] => {
      const occurrence = expandOccurrences(event, event.exceptions, startDate, startDate, tz).find((item) => {
        const localDate = formatLocalDate(item.startUtc, tz);
        const actualTitle =
          event.exceptions.find((exception) => exception.originalDate === item.occurrenceDate)?.overrideTitle ??
          event.title;
        return localDate === startDate && normalizeTitle(actualTitle) === normalizeTitle(title);
      });
      if (!occurrence) return [];
      return [
        {
          eventId: event.id,
          title: event.title,
          startDate,
          startTime: occurrence.allDay
            ? null
            : new Intl.DateTimeFormat('en-GB', {
                timeZone: tz,
                hour: '2-digit',
                minute: '2-digit',
                hourCycle: 'h23',
              }).format(occurrence.startUtc),
          kind: event.kind,
          version: eventVersion(event),
          canReplace:
            kind !== 'recurring' && event.kind !== 'recurring' && canEditEvent(role, actorId, event.createdBy),
        },
      ];
    });
  }
  function saveResolved(
    familyId: string,
    actorId: string,
    role: FamilyRole,
    data: EventData,
    resolution?: EventDuplicateResolution,
  ) {
    if (!resolution || resolution.action === 'add') return create(familyId, actorId, data);
    const matches = duplicates(familyId, actorId, role, data.title, data.startDate, data.kind);
    if (resolution.action === 'check') {
      if (matches.length) throw new DuplicateEventError(matches);
      return create(familyId, actorId, data);
    }
    const match = matches.find((item) => item.eventId === resolution.eventId);
    if (!match || match.version !== resolution.version)
      throw new DuplicateEventError(
        matches,
        'Istniejące wydarzenie zmieniło się lub zostało usunięte. Wybierz ponownie.',
      );
    const existing = get(familyId, match.eventId);
    checkEdit(existing, actorId, role);
    if (!match.canReplace)
      throw new ApiError(
        409,
        'INVALID_REPLACEMENT',
        'Serię cykliczną zmień w kalendarzu albo dodaj kolejne wydarzenie.',
      );
    checkParticipants(familyId, data.participantIds);
    return repository.update(familyId, existing.id, data, actorId);
  }
  function createResolved(
    familyId: string,
    actorId: string,
    role: FamilyRole,
    data: EventData,
    resolution?: EventDuplicateResolution,
  ) {
    return database.db.transaction(() => saveResolved(familyId, actorId, role, data, resolution), {
      behavior: 'immediate',
    });
  }
  function importEvents(familyId: string, actorId: string, batch: ImportEvents): ImportEventResult[] {
    return batch.items.map(({ operationId, event, duplicateResolution }): ImportEventResult => {
      const parsed = importEventSchema.safeParse(event);
      if (!parsed.success)
        return {
          operationId,
          status: 'error',
          error: { code: 'VALIDATION_ERROR', message: 'Dane wydarzenia jednorazowego są niepoprawne.' },
        };
      // Parsing fixes field order, trims strings and fills defaults before hashing.
      const fingerprint = createHash('sha256')
        .update(JSON.stringify(duplicateResolution ? [parsed.data, duplicateResolution] : parsed.data))
        .digest('hex');
      try {
        return database.db.transaction(
          (): ImportEventResult => {
            const actor = repository.findImportActor(familyId, actorId);
            if (!actor) throw new ApiError(403, 'FORBIDDEN', 'Brak dostępu do tej rodziny.');
            checkParticipants(familyId, parsed.data.participantIds);
            const previous = repository.findImportOperation(familyId, actorId, operationId);
            if (previous) {
              if (previous.fingerprint !== fingerprint)
                throw new ApiError(409, 'OPERATION_CONFLICT', 'Ta operacja została już użyta z innymi danymi.');
              if (duplicateResolution?.action === 'replace') {
                const existing = repository.find(familyId, duplicateResolution.eventId);
                if (existing) checkEdit(existing, actorId, actor.role);
              }
              return { operationId, status: 'already_created', eventId: previous.eventId };
            }
            const created = saveResolved(familyId, actorId, actor.role, parsed.data, duplicateResolution);
            repository.recordImportOperation({
              familyId,
              userId: actorId,
              id: operationId,
              fingerprint,
              eventId: created.id,
              createdAt: Date.now(),
            });
            return { operationId, status: 'created', eventId: created.id };
          },
          { behavior: 'immediate' },
        );
      } catch (error) {
        return {
          operationId,
          status: 'error',
          error:
            error instanceof ApiError
              ? {
                  code: error.code,
                  message: error.message,
                  ...(error instanceof DuplicateEventError ? { duplicates: error.duplicates } : {}),
                }
              : { code: 'INTERNAL_ERROR', message: 'Nie udało się zapisać wydarzenia. Spróbuj ponownie.' },
        };
      }
    });
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
    const tz = timezone(familyId);
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
    const today = formatLocalDate(Date.now(), timezone(familyId));
    return repository.upcomingDistant(familyId, today);
  }
  return {
    get,
    find: repository.find,
    list: repository.list,
    create,
    createResolved,
    duplicates,
    importEvents,
    update,
    remove,
    occurrences,
    upcomingDistant,
  };
}
