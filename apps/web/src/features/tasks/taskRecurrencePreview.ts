import { localDateTimeToUtc, nextTaskOccurrence, type TaskRecurrenceRule } from '@rodzina/shared';

/** A bounded preview: closing a late occurrence never creates these missed copies. */
export function skippedTaskDates(rule: TaskRecurrenceRule, plannedDate: string, now: number) {
  const dates: string[] = [];
  if (rule.mode !== 'schedule') return { dates, more: false };
  let date = plannedDate;
  for (;;) {
    const instant = localDateTimeToUtc(date, rule.time ?? '00:00', rule.timezone);
    if (instant < 0) return { dates, more: true };
    const next = nextTaskOccurrence(rule, date, {
      actualAt: instant,
      receivedAt: instant,
      createdAt: 0,
      previousClosedAt: null,
    });
    if (
      next.status !== 'ready' ||
      !next.nextDate ||
      localDateTimeToUtc(next.nextDate, rule.time ?? '00:00', rule.timezone) > now
    )
      return { dates, more: false };
    if (dates.length === 8) return { dates, more: true };
    dates.push(next.nextDate);
    date = next.nextDate;
  }
}
