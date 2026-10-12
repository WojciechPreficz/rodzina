import type { Reminder, TimeReminder } from '@rodzina/shared';
import { labels } from '../i18n/pl.js';

const text = labels.calendarUi;
export type ReminderInput = TimeReminder & { audience: Reminder['audience'] };
export type ReminderItem = ReminderInput & { nextFireAt?: number | null };
export const eventReminderAudiences: Reminder['audience'][] = ['participants', 'adults', 'family', 'owner'];
export const presets = [
  { offsetValue: 0, offsetUnit: 'minute' },
  { offsetValue: 15, offsetUnit: 'minute' },
  { offsetValue: 1, offsetUnit: 'hour' },
  { offsetValue: 1, offsetUnit: 'day' },
  { offsetValue: 2, offsetUnit: 'day' },
  { offsetValue: 1, offsetUnit: 'week' },
] as const;

export function reminderInput(reminder: Reminder): ReminderInput {
  return reminder.type === 'absolute'
    ? { type: 'absolute', remindAt: reminder.remindAt!, audience: reminder.audience }
    : {
        type: 'offset',
        offsetValue: reminder.offsetValue!,
        offsetUnit: reminder.offsetUnit!,
        audience: reminder.audience,
      };
}

export function describeReminder(reminder: ReminderInput, timezone: string): string {
  if (reminder.type === 'absolute') {
    return new Intl.DateTimeFormat('pl-PL', { timeZone: timezone, dateStyle: 'long', timeStyle: 'short' }).format(
      reminder.remindAt,
    );
  }
  const index = presets.findIndex(
    (p) => p.offsetValue === reminder.offsetValue && p.offsetUnit === reminder.offsetUnit,
  );
  return index >= 0
    ? text.reminderPresets[index]!
    : `${reminder.offsetValue} ${text.reminderUnits[reminder.offsetUnit]} ${text.reminderBefore}`;
}
