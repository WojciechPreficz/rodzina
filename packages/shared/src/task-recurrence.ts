import { TZDate } from '@date-fns/tz';
import { calendarDateSchema } from './schemas/events.js';
import { taskRecurrenceRuleSchema, type TaskRecurrenceRule } from './schemas/task-recurrence.js';
import { localDateTimeToUtc } from './time.js';

const DAY_MS = 86_400_000;
const FUTURE_TOLERANCE_MS = 5 * 60_000;

function dateValue(date: string): Date {
  return new Date(`${calendarDateSchema.parse(date)}T00:00:00Z`);
}

function dateString(date: Date): string | null {
  const year = date.getUTCFullYear();
  return year >= 100 && year <= 9999 ? date.toISOString().slice(0, 10) : null;
}

function addCalendar(date: string, unit: TaskRecurrenceRule['unit'], count: number): string | null {
  const value = dateValue(date);
  if (unit === 'day' || unit === 'week') value.setUTCDate(value.getUTCDate() + count * (unit === 'week' ? 7 : 1));
  else {
    const day = value.getUTCDate();
    value.setUTCDate(1);
    value.setUTCMonth(value.getUTCMonth() + count * (unit === 'year' ? 12 : 1));
    const last = new Date(value.getTime());
    last.setUTCMonth(last.getUTCMonth() + 1, 0);
    value.setUTCDate(Math.min(day, last.getUTCDate()));
  }
  return dateString(value);
}

function isoWeekday(value: Date): number {
  return value.getUTCDay() || 7;
}

function candidates(rule: TaskRecurrenceRule, period: number): string[] {
  if (rule.unit !== 'week') {
    const date = addCalendar(rule.startDate, rule.unit, period * rule.interval);
    return date ? [date] : [];
  }
  const start = dateValue(rule.startDate);
  const monday = new Date(start.getTime());
  monday.setUTCDate(monday.getUTCDate() - isoWeekday(start) + 1 + period * rule.interval * 7);
  return [...(rule.weekdays ?? [isoWeekday(start)])]
    .sort((a, b) => a - b)
    .flatMap((weekday) => {
      const value = new Date(monday.getTime());
      value.setUTCDate(value.getUTCDate() + weekday - 1);
      const date = dateString(value);
      return date && date >= rule.startDate ? [date] : [];
    });
}

function instant(rule: TaskRecurrenceRule, date: string): number {
  return localDateTimeToUtc(date, rule.time ?? '00:00', rule.timezone);
}

function localDate(at: number, timezone: string): string {
  const value = new TZDate(at, timezone);
  return `${String(value.getFullYear()).padStart(4, '0')}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function withinEnd(rule: TaskRecurrenceRule, date: string): boolean {
  return rule.endDate === null || date <= rule.endDate;
}

/** The first selected weekday may be later than startDate. */
export function firstTaskOccurrence(input: TaskRecurrenceRule): string | null {
  const rule = taskRecurrenceRuleSchema.parse(input);
  if (rule.mode === 'after_completion') return rule.startDate;
  const date = candidates(rule, 0)[0] ?? candidates(rule, 1)[0];
  return date && withinEnd(rule, date) ? date : null;
}

export interface TaskClosureTime {
  actualAt: number;
  receivedAt: number;
  createdAt: number;
  previousClosedAt: number | null;
}

export type NextTaskOccurrence =
  | { status: 'ready'; actualAt: number; nextDate: string | null }
  | { status: 'review'; actualAt: number; reason: 'future_time' | 'clock_regression' };

/** No I/O or clock reads: callers supply the actual offline time and server observation. */
export function nextTaskOccurrence(
  input: TaskRecurrenceRule,
  plannedDate: string,
  closure: TaskClosureTime,
): NextTaskOccurrence {
  const rule = taskRecurrenceRuleSchema.parse(input);
  calendarDateSchema.parse(plannedDate);
  for (const value of [closure.actualAt, closure.receivedAt, closure.createdAt, closure.previousClosedAt ?? 0]) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 253402300799999)
      throw new RangeError('Invalid closure timestamp');
  }
  const { actualAt, receivedAt, createdAt, previousClosedAt } = closure;
  if (actualAt > receivedAt + FUTURE_TOLERANCE_MS) return { status: 'review', actualAt, reason: 'future_time' };
  if (actualAt < createdAt || (previousClosedAt !== null && actualAt < previousClosedAt))
    return { status: 'review', actualAt, reason: 'clock_regression' };
  const completedDate = localDate(actualAt, rule.timezone);
  if (rule.mode === 'after_completion') {
    const date = addCalendar(completedDate, rule.unit, rule.interval);
    return { status: 'ready', actualAt, nextDate: date && withinEnd(rule, date) ? date : null };
  }

  const threshold = Math.max(instant(rule, plannedDate), actualAt);
  const from = dateValue(rule.startDate);
  const to = dateValue(localDate(threshold, rule.timezone));
  let distance: number;
  if (rule.unit === 'month' || rule.unit === 'year') {
    distance = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth();
    if (rule.unit === 'year') distance = Math.floor(distance / 12);
  } else {
    distance = Math.floor((to.getTime() - from.getTime()) / DAY_MS);
    if (rule.unit === 'week') distance = Math.floor((distance + isoWeekday(from) - 1) / 7);
  }
  // Seek directly to the relevant period, even after years offline.
  let period = Math.max(0, Math.floor(distance / rule.interval));
  for (;;) {
    const dates = candidates(rule, period++);
    if (!dates.length) return { status: 'ready', actualAt, nextDate: null };
    for (const date of dates) {
      if (!withinEnd(rule, date)) return { status: 'ready', actualAt, nextDate: null };
      if (instant(rule, date) > threshold) return { status: 'ready', actualAt, nextDate: date };
    }
  }
}
