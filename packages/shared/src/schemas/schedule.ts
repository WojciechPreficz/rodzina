import { z } from 'zod';
import { calendarDateSchema } from './events.js';

const timestamp = z.number().int().nonnegative();
export const scheduledReminderSchema = z.object({
  key: z.string().min(1),
  reminderId: z.string().uuid(),
  sourceType: z.literal('event'),
  sourceId: z.string().uuid(),
  occurrenceDate: calendarDateSchema,
  fireAt: timestamp,
  title: z.string(),
  body: z.string(),
  url: z.string().startsWith('/kalendarz/wydarzenie/'),
});
export const reminderScheduleSchema = z.object({
  ok: z.literal(true),
  generatedAt: timestamp,
  validUntil: timestamp,
  reminders: z.array(scheduledReminderSchema),
});
export type ScheduledReminder = z.infer<typeof scheduledReminderSchema>;
export type ReminderSchedule = z.infer<typeof reminderScheduleSchema>;
