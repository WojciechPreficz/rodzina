import { calendarDateSchema, expandOccurrences, localDateTimeToUtc, type CalendarEvent } from '@rodzina/shared';
import type { AuthUser } from '../../auth.js';

export function canEditEvent(user: AuthUser, event: CalendarEvent): boolean {
  return user.role !== 'child' || event.createdBy === user.id;
}

export function getEventOccurrence(event: CalendarEvent, date: string | null, timezone: string) {
  const occurrenceDate = date ?? event.startDate;
  if (!calendarDateSchema.safeParse(occurrenceDate).success) return undefined;
  if (event.datePrecision === 'month') {
    if (occurrenceDate !== event.startDate) return undefined;
    const startUtc = localDateTimeToUtc(event.startDate, '00:00', timezone);
    return { eventId: event.id, occurrenceDate, startUtc, endUtc: startUtc, allDay: true, isException: false };
  }
  // The address contains the original date, even when an exception moves the occurrence.
  const exception = event.exceptions.find((item) => item.originalDate === occurrenceDate);
  const actualDate = exception?.overrideStartDate ?? occurrenceDate;
  return expandOccurrences(event, event.exceptions, actualDate, actualDate, timezone).find(
    (item) => item.occurrenceDate === occurrenceDate,
  );
}
