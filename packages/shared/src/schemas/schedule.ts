import { z } from 'zod';
import { calendarDateSchema } from './events.js';

const timestamp = z.number().int().nonnegative();
export const scheduledReminderSchema = z
  .object({
    key: z.string().min(1),
    reminderId: z.string().uuid(),
    sourceType: z.enum(['event', 'task']),
    sourceId: z.string().uuid(),
    occurrenceDate: calendarDateSchema,
    fireAt: timestamp,
    title: z.string(),
    body: z.string(),
    url: z.string(),
  })
  .refine(
    (item) =>
      item.sourceType === 'event'
        ? /^\/kalendarz\/wydarzenie\/[a-zA-Z0-9_-]+\?data=\d{4}-\d{2}-\d{2}$/.test(item.url)
        : /^\/zadania\/[a-zA-Z0-9_-]+\?zadanie=[a-zA-Z0-9_-]+$/.test(item.url),
    'Niepoprawny adres przypomnienia.',
  );
export const reminderScheduleSchema = z.object({
  ok: z.literal(true),
  generatedAt: timestamp,
  validUntil: timestamp,
  reminders: z.array(scheduledReminderSchema),
});
export type ScheduledReminder = z.infer<typeof scheduledReminderSchema>;
export type ReminderSchedule = z.infer<typeof reminderScheduleSchema>;
