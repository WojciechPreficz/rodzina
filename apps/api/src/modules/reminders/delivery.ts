import { eventUrl, expandOccurrences, type CalendarEvent, type Reminder } from '@rodzina/shared';

export interface ReminderMember {
  id: string;
  familyId: string;
  displayName: string;
  role: 'admin' | 'member' | 'child';
}

export interface EventReminderSource {
  event: CalendarEvent;
  /** Current members, loaded at delivery time rather than when the reminder was created. */
  members: readonly ReminderMember[];
}

/** All current family members can read events, including children. */
export function resolveRecipients(reminder: Reminder, source: EventReminderSource): string[] {
  const { event } = source;
  if (reminder.familyId !== event.familyId || reminder.eventId !== event.id) return [];
  const visible = source.members.filter((member) => member.familyId === event.familyId);
  const adults = visible.filter((member) => member.role !== 'child');
  let candidates: readonly (string | null)[];
  switch (reminder.audience) {
    case 'participants':
      candidates = event.participants.length ? event.participants.map(({ id }) => id) : [event.createdBy];
      break;
    case 'family':
      candidates = visible.map(({ id }) => id);
      break;
    case 'adults':
      candidates = adults.map(({ id }) => id);
      break;
    case 'owner':
      candidates = [event.createdBy];
      break;
    case 'user':
      candidates = [reminder.userId];
      break;
  }
  const recipients = visible.filter(({ id }) => candidates.includes(id));
  return [...new Set((recipients.length ? recipients : adults).map(({ id }) => id))];
}

export interface ReminderPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
}

function localParts(utc: number, tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(utc);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

function monthLabel(months: number) {
  if (months === 1) return 'miesiąc';
  return months % 10 >= 2 && months % 10 <= 4 && (months % 100 < 12 || months % 100 > 14) ? 'miesiące' : 'miesięcy';
}

/** occurrenceDate is the original identity, even for a rescheduled occurrence. */
export function buildReminderPayload(
  source: EventReminderSource,
  occurrenceDate: string,
  nowUtc: number,
  tz: string,
): ReminderPayload {
  const { event } = source;
  const exception = event.exceptions.find((item) => item.originalDate === occurrenceDate);
  const effectiveDate = exception?.overrideStartDate ?? occurrenceDate;
  // Month deadlines are hidden from the calendar grid, but their first day anchors reminders.
  const temporalEvent = event.datePrecision === 'month' ? { ...event, datePrecision: 'day' as const } : event;
  const occurrence = expandOccurrences(temporalEvent, event.exceptions, effectiveDate, effectiveDate, tz).find(
    (item) => item.occurrenceDate === occurrenceDate,
  );
  if (!occurrence) throw new RangeError('Event occurrence does not exist');
  const start = localParts(occurrence.startUtc, tz);
  const today = localParts(nowUtc, tz).date;
  // These UTC date-only values count calendar days, not elapsed hours across DST.
  const days = (Date.parse(`${start.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000;
  const months =
    (Number(start.date.slice(0, 4)) - Number(today.slice(0, 4))) * 12 +
    Number(start.date.slice(5, 7)) -
    Number(today.slice(5, 7));
  let when: string;
  if (event.datePrecision === 'month' && months === 0) when = 'W tym miesiącu';
  else if (months > 0 && (event.datePrecision === 'month' || start.date.slice(8) === today.slice(8)))
    when = `Za ${months} ${monthLabel(months)}`;
  else if (days === 0) when = 'Dziś';
  else if (days === 1) when = 'Jutro';
  else if (days > 1) when = `Za ${days} dni`;
  else when = start.date.split('-').reverse().join('.');
  if (!occurrence.allDay) when += ` ${start.time}`;
  const members = new Map(
    source.members.filter((member) => member.familyId === event.familyId).map((member) => [member.id, member]),
  );
  const names = [...new Set(event.participants.map(({ id }) => id))]
    .map((id) => members.get(id)?.displayName)
    .filter((name) => name !== undefined);
  const title = exception?.overrideTitle ?? event.title;
  return {
    title: `${when}: ${title}${names.length ? ` (${names.join(', ')})` : ''}`,
    body: event.location ?? '',
    tag: `event:${event.id}:${occurrenceDate}`,
    url: eventUrl(event.id, occurrenceDate),
  };
}
