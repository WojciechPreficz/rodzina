import { TZDate } from '@date-fns/tz';
import { addDays, addMonths, addWeeks, subDays, subMonths, subWeeks } from 'date-fns';
import * as rrule from 'rrule';
import type { RRule as RecurrenceRule } from 'rrule';

// Node loads rrule's CommonJS main; browser bundlers load its named ESM exports.
const { RRule } = (Reflect.get(rrule, 'default') as typeof rrule | undefined) ?? rrule;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Only the temporal fields of an event; no database or API schema dependency. */
export interface TimeEvent {
  id: string;
  startDate: string;
  startTime: string | null;
  durationMinutes: number | null;
  datePrecision: 'day' | 'month';
  rrule: string | null;
}

export interface TimeException {
  originalDate: string;
  isCancelled: boolean;
  overrideStartDate?: string | null;
  // Undefined inherits the original time; null explicitly makes the occurrence all-day.
  overrideStartTime?: string | null;
  overrideDurationMinutes?: number | null;
}

export interface Occurrence {
  eventId: string;
  /** Original date identifying the occurrence, even when it has been moved. */
  occurrenceDate: string;
  startUtc: number;
  endUtc: number;
  allDay: boolean;
  isException: boolean;
}

export type OffsetUnit = 'minute' | 'hour' | 'day' | 'week' | 'month';
export type TimeReminder =
  { type: 'offset'; offsetValue: number; offsetUnit: OffsetUnit } | { type: 'absolute'; remindAt: number };

/** Map a task or document deadline to this shape without changing the time logic. */
export interface DeadlineSource {
  date: string | null;
  time?: string | null;
  completed?: boolean;
}

export type ReminderSource = DeadlineSource | (TimeEvent & { exceptions?: readonly TimeException[] });

function floatingDate(date: string, time = '00:00'): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new RangeError('Expected a YYYY-MM-DD date and HH:mm time');
  }
  const value = new Date(`${date}T${time}:00.000Z`);
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) {
    throw new RangeError('Invalid calendar date');
  }
  return value;
}

function dateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function timeString(value: Date): string {
  return value.toISOString().slice(11, 16);
}

/** The UTC fields of a floating date represent wall-clock fields, not an instant. */
function floatingToZoned(value: Date, tz: string): TZDate {
  return new TZDate(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
    value.getUTCHours(),
    value.getUTCMinutes(),
    value.getUTCSeconds(),
    value.getUTCMilliseconds(),
    tz,
  );
}

function zonedToFloating(value: TZDate): Date {
  return new Date(
    Date.UTC(
      value.getFullYear(),
      value.getMonth(),
      value.getDate(),
      value.getHours(),
      value.getMinutes(),
      value.getSeconds(),
      value.getMilliseconds(),
    ),
  );
}

export function localDateTimeToUtc(date: string, time: string, tz: string): number {
  return floatingToZoned(floatingDate(date, time), tz).getTime();
}

function eventRule(event: TimeEvent): RecurrenceRule | null {
  if (!event.rrule) return null;
  const options = RRule.parseString(event.rrule);
  if (options.dtstart || options.tzid) {
    throw new RangeError('RRULE must not contain DTSTART or TZID');
  }
  // Never let rrule apply a timezone: recurrence is expanded as floating local time.
  return new RRule({ ...options, dtstart: floatingDate(event.startDate, event.startTime ?? '00:00') });
}

function originalOnDate(event: TimeEvent, rule: RecurrenceRule | null, date: string): Date | null {
  const from = floatingDate(date);
  if (!rule) return date === event.startDate ? floatingDate(date, event.startTime ?? '00:00') : null;
  const candidate = rule.after(from, true);
  return candidate && dateString(candidate) === date ? candidate : null;
}

export function hasEventOccurrence(event: TimeEvent, date: string): boolean {
  return originalOnDate(event, eventRule(event), date) !== null;
}

export function firstEventOccurrenceDate(event: TimeEvent): string | null {
  const rule = eventRule(event);
  if (!rule) return event.startDate;
  const first = rule.after(floatingDate(event.startDate, event.startTime ?? '00:00'), true);
  return first ? dateString(first) : null;
}

/** Split floating recurrence bounds, retaining the remaining COUNT in the new series. */
export function splitEventRule(event: TimeEvent, date: string): { previous: string; following: string } {
  const rule = eventRule(event);
  if (!rule || !originalOnDate(event, rule, date)) throw new RangeError('Expected a recurring occurrence');
  const before = new Date(floatingDate(date).getTime() - 1);
  const parts = event.rrule!.replace(/^RRULE:/, '').split(';');
  const unbounded = parts.filter((part) => !/^(COUNT|UNTIL)=/.test(part));
  const previous = [...unbounded, `UNTIL=${dateString(before).replaceAll('-', '')}T235959`].join(';');
  const count = rule.origOptions.count;
  const following =
    count == null
      ? parts.join(';')
      : [...unbounded, `COUNT=${count - rule.between(floatingDate(event.startDate), before, true).length}`].join(';');
  return { previous, following };
}

function effectiveStart(
  event: TimeEvent,
  original: Date,
  exception?: TimeException,
): { date: string; time: string | null } {
  return {
    date: exception?.overrideStartDate ?? dateString(original),
    time:
      exception?.overrideStartTime !== undefined
        ? exception.overrideStartTime
        : event.startTime === null
          ? null
          : timeString(original),
  };
}

function occurrence(event: TimeEvent, original: Date, tz: string, exception?: TimeException): Occurrence {
  const start = effectiveStart(event, original, exception);
  const allDay = start.time === null;
  const zonedStart = floatingToZoned(floatingDate(start.date, start.time ?? '00:00'), tz);
  const duration =
    exception?.overrideDurationMinutes !== undefined ? exception.overrideDurationMinutes : event.durationMinutes;
  return {
    eventId: event.id,
    occurrenceDate: dateString(original),
    startUtc: zonedStart.getTime(),
    endUtc: allDay
      ? addDays(zonedStart, (duration ?? 1440) / 1440).getTime()
      : zonedStart.getTime() + (duration ?? 0) * MINUTE_MS,
    allDay,
    isException: exception !== undefined,
  };
}

/** Inclusive local-date bounds, filtered by the effective start date after exceptions. */
export function expandOccurrences(
  event: TimeEvent,
  exceptions: readonly TimeException[],
  fromDate: string,
  toDate: string,
  tz: string,
): Occurrence[] {
  const from = floatingDate(fromDate);
  const to = new Date(floatingDate(toDate).getTime() + DAY_MS - 1);
  if (from > to) throw new RangeError('Occurrence range is reversed');
  if (event.datePrecision === 'month') return [];

  const rule = eventRule(event);
  const originals = rule ? rule.between(from, to, true) : [floatingDate(event.startDate, event.startTime ?? '00:00')];
  const byDate = new Map(originals.map((value) => [dateString(value), value]));
  const overrides = new Map(exceptions.map((value) => [value.originalDate, value]));
  // Include occurrences moved into this range from outside it, but ignore orphan exceptions.
  for (const exception of exceptions) {
    if (
      !exception.isCancelled &&
      exception.overrideStartDate &&
      exception.overrideStartDate >= fromDate &&
      exception.overrideStartDate <= toDate
    ) {
      const original = originalOnDate(event, rule, exception.originalDate);
      if (original) byDate.set(exception.originalDate, original);
    }
  }
  return [...byDate.values()]
    .flatMap((original) => {
      const exception = overrides.get(dateString(original));
      if (exception?.isCancelled) return [];
      const start = effectiveStart(event, original, exception);
      if (start.date > toDate) return [];
      const result = occurrence(event, original, tz, exception);
      if (start.date < fromDate && (rule || result.endUtc <= localDateTimeToUtc(fromDate, '00:00', tz))) return [];
      return [result];
    })
    .sort((left, right) => left.startUtc - right.startUtc || left.occurrenceDate.localeCompare(right.occurrenceDate));
}

function offsetFireAt(
  reminder: Extract<TimeReminder, { type: 'offset' }>,
  date: string,
  time: string | null,
  tz: string,
): number {
  const base = floatingToZoned(floatingDate(date, time ?? '09:00'), tz);
  const amount = reminder.offsetValue;
  switch (reminder.offsetUnit) {
    case 'minute':
      return base.getTime() - amount * MINUTE_MS;
    case 'hour':
      return base.getTime() - amount * 60 * MINUTE_MS;
    case 'day':
      return subDays(base, amount).getTime();
    case 'week':
      return subWeeks(base, amount).getTime();
    case 'month':
      return subMonths(base, amount).getTime();
  }
}

function searchStart(reminder: Extract<TimeReminder, { type: 'offset' }>, nowUtc: number, tz: string): Date {
  const localNow = new TZDate(nowUtc, tz);
  const amount = reminder.offsetValue;
  let earliest: TZDate;
  switch (reminder.offsetUnit) {
    case 'minute':
      earliest = new TZDate(nowUtc + amount * MINUTE_MS, tz);
      break;
    case 'hour':
      earliest = new TZDate(nowUtc + amount * 60 * MINUTE_MS, tz);
      break;
    case 'day':
      earliest = addDays(localNow, amount);
      break;
    case 'week':
      earliest = addWeeks(localNow, amount);
      break;
    case 'month':
      earliest = addMonths(localNow, amount);
      break;
  }
  // A conservative lower bound covers DST gaps/folds and non-invertible month-end clamping.
  return new Date(zonedToFloating(earliest).getTime() - 4 * DAY_MS);
}

/** Full read-only expansion in (fromUtc, toUtc], including simultaneous moved occurrences. */
export function expandEventReminderSchedule(
  reminder: TimeReminder,
  event: TimeEvent & { exceptions?: readonly TimeException[] },
  fromUtc: number,
  toUtc: number,
  tz: string,
): { fireAt: number; occurrenceDate: string; allDay: boolean }[] {
  if (reminder.type === 'absolute') {
    if (reminder.remindAt <= fromUtc || reminder.remindAt > toUtc) return [];
    // Match the server job's association of absolute reminders with a series occurrence.
    const zero = { type: 'offset', offsetValue: 0, offsetUnit: 'minute' } as const;
    const match =
      computeNextEventReminder(zero, event, reminder.remindAt - 1, tz) ??
      computeNextEventReminder(zero, event, localDateTimeToUtc(event.startDate, '00:00', tz) - 1, tz);
    return match ? [{ ...match, fireAt: reminder.remindAt }] : [];
  }
  if (!Number.isSafeInteger(reminder.offsetValue) || reminder.offsetValue < 0)
    throw new RangeError('Reminder offset must be a non-negative integer');
  const fromDate = dateString(searchStart(reminder, fromUtc, tz));
  // searchStart includes a four-day margin; add eight for a conservative upper bound.
  const toDate = dateString(new Date(searchStart(reminder, toUtc, tz).getTime() + 8 * DAY_MS));
  const temporalEvent = { ...event, datePrecision: 'day' as const };
  return expandOccurrences(temporalEvent, event.exceptions ?? [], fromDate, toDate, tz)
    .flatMap((item) => {
      const exception = event.exceptions?.find((value) => value.originalDate === item.occurrenceDate);
      const start = effectiveStart(event, floatingDate(item.occurrenceDate, event.startTime ?? '00:00'), exception);
      const fireAt = offsetFireAt(reminder, start.date, start.time, tz);
      return fireAt > fromUtc && fireAt <= toUtc
        ? [{ fireAt, occurrenceDate: item.occurrenceDate, allDay: item.allDay }]
        : [];
    })
    .sort((a, b) => a.fireAt - b.fireAt || a.occurrenceDate.localeCompare(b.occurrenceDate));
}

/** Returns a strictly future UTC timestamp, or null when no active reminder remains. */
export function computeNextFireAt(
  reminder: TimeReminder,
  source: ReminderSource,
  nowUtc: number,
  tz: string,
): number | null {
  if ('completed' in source && source.completed) return null;
  if (reminder.type === 'absolute') return reminder.remindAt > nowUtc ? reminder.remindAt : null;
  if (!Number.isSafeInteger(reminder.offsetValue) || reminder.offsetValue < 0) {
    throw new RangeError('Reminder offset must be a non-negative integer');
  }
  if ('date' in source) {
    if (source.date === null) return null;
    const fire = offsetFireAt(reminder, source.date, source.time ?? null, tz);
    return fire > nowUtc ? fire : null;
  }

  return computeNextEventReminder(reminder, source, nowUtc, tz)?.fireAt ?? null;
}

/** Includes the original occurrence identity for delivery, including moved exceptions. */
export function computeNextEventReminder(
  reminder: Extract<TimeReminder, { type: 'offset' }>,
  event: TimeEvent & { exceptions?: readonly TimeException[] },
  nowUtc: number,
  tz: string,
): { fireAt: number; occurrenceDate: string; allDay: boolean } | null {
  if (!Number.isSafeInteger(reminder.offsetValue) || reminder.offsetValue < 0) {
    throw new RangeError('Reminder offset must be a non-negative integer');
  }
  const rule = eventRule(event);
  const exceptions = event.exceptions ?? [];
  const overrides = new Map(exceptions.map((value) => [value.originalDate, value]));
  let next: number | null = null;
  let match: { fireAt: number; occurrenceDate: string; allDay: boolean } | null = null;
  const consider = (original: Date, exception?: TimeException) => {
    if (exception?.isCancelled) return false;
    const start = effectiveStart(event, original, exception);
    const fire = offsetFireAt(reminder, start.date, start.time, tz);
    if (fire > nowUtc && (next === null || fire < next)) {
      next = fire;
      match = { fireAt: fire, occurrenceDate: dateString(original), allDay: start.time === null };
    }
    return fire > nowUtc;
  };

  // Moved occurrences can fire before or after the ordinary series, even after its UNTIL.
  for (const exception of exceptions) {
    if (exception.isCancelled) continue;
    const original = originalOnDate(event, rule, exception.originalDate);
    if (original) consider(original, exception);
  }
  if (!rule) {
    if (!overrides.has(event.startDate)) consider(floatingDate(event.startDate, event.startTime ?? '00:00'));
    return match;
  }

  let candidate = rule.after(searchStart(reminder, nowUtc, tz), true);
  while (candidate) {
    if (!overrides.has(dateString(candidate))) {
      if (consider(candidate)) break;
    }
    candidate = rule.after(candidate);
  }
  return match;
}
