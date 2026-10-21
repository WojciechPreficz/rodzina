import 'temporal-polyfill/global';
import { Temporal } from 'temporal-polyfill';
import type { CalendarEventExternal, CalendarType } from '@schedule-x/calendar';
import type { Member } from '@rodzina/shared';

import type { CalendarOccurrence, CalendarRange } from './calendarApi.js';

export const FAMILY_CALENDAR = 'family';

export function todayInTimezone(timezone: string): string {
  return Temporal.Now.plainDateISO(timezone).toString();
}

export function monthRange(date: string): CalendarRange {
  const first = Temporal.PlainDate.from(date).with({ day: 1 });
  return { from: first.subtract({ days: 7 }).toString(), to: first.add({ months: 1, days: 7 }).toString() };
}

export function toScheduleX(
  occurrences: CalendarOccurrence[],
  timezone: string,
  selected: string[] = [],
): CalendarEventExternal[] {
  return occurrences
    .filter((event) => selected.length === 0 || event.participants.some((p) => selected.includes(p.id)))
    .map((event) => {
      const start = Temporal.Instant.fromEpochMilliseconds(event.startUtc).toZonedDateTimeISO(timezone);
      const end = Temporal.Instant.fromEpochMilliseconds(event.endUtc).toZonedDateTimeISO(timezone);
      const participant = event.participants.find((p) => selected.length === 0 || selected.includes(p.id));
      return {
        id: `${event.eventId}_${event.occurrenceDate}`,
        eventId: event.eventId,
        occurrenceDate: event.occurrenceDate,
        title: event.title,
        people: event.participants.map((p) => p.displayName),
        ...(event.location ? { location: event.location } : {}),
        calendarId: participant?.id ?? FAMILY_CALENDAR,
        start: event.allDay ? start.toPlainDate() : start,
        // Schedule-X uses inclusive end dates for all-day events; the API uses an exclusive UTC end.
        end: event.allDay ? end.toPlainDate().subtract({ days: 1 }) : end,
      };
    });
}

export function memberCalendars(members: Member[]): Record<string, CalendarType> {
  const make = (label: string, color: string): CalendarType => ({
    label,
    colorName: `member${color.replace('#', '')}`,
    lightColors: { main: color, container: '#f1f3f5', onContainer: '#212529' },
    darkColors: { main: color, container: '#343a40', onContainer: '#ffffff' },
  });
  return Object.fromEntries([
    [FAMILY_CALENDAR, make('Rodzina', '#426b53')],
    ...members.map((member) => [member.id, make(member.displayName, member.color)]),
  ]);
}
