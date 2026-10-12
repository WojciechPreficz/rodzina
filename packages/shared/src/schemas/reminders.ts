import { z } from 'zod';

const timestamp = z.number().int().min(0).max(8640000000000000);
const offset = z.object({
  type: z.literal('offset'),
  offsetValue: z.number().int().min(0).max(10000),
  offsetUnit: z.enum(['minute', 'hour', 'day', 'week', 'month']),
});
const absolute = z.object({ type: z.literal('absolute'), remindAt: timestamp });
const audience = z.enum(['participants', 'family', 'adults', 'owner']);
export const sharedEventReminderSchema = z.discriminatedUnion('type', [
  offset.extend({ audience: audience.default('participants') }).strict(),
  absolute.extend({ audience: audience.default('participants') }).strict(),
]);
// Only event sources are supported until tasks and documents are implemented.
export const myRemindersQuerySchema = z.object({ eventId: z.string().uuid() }).strict();
export const createMyReminderSchema = z.discriminatedUnion('type', [
  offset.extend({ eventId: z.string().uuid() }).strict(),
  absolute.extend({ eventId: z.string().uuid() }).strict(),
]);
export const reminderSchema = z.object({
  id: z.string().uuid(),
  familyId: z.string().uuid(),
  eventId: z.string().uuid().nullable(),
  taskId: z.string().uuid().nullable(),
  documentId: z.string().uuid().nullable(),
  type: z.enum(['offset', 'absolute']),
  offsetValue: z.number().int().nullable(),
  offsetUnit: z.enum(['minute', 'hour', 'day', 'week', 'month']).nullable(),
  remindAt: timestamp.nullable(),
  audience: z.enum(['participants', 'family', 'adults', 'owner', 'user']),
  userId: z.string().uuid().nullable(),
  createdBy: z.string().uuid().nullable(),
  nextFireAt: timestamp.nullable(),
  lastSentAt: timestamp.nullable(),
});
export const reminderResponseSchema = z.object({ ok: z.literal(true), reminder: reminderSchema });
export const myRemindersResponseSchema = z.object({ ok: z.literal(true), reminders: z.array(reminderSchema) });
export const deleteReminderResponseSchema = z.object({ ok: z.literal(true), deleted: z.literal(true) });
export type SharedEventReminder = z.infer<typeof sharedEventReminderSchema>;
export type CreateMyReminder = z.infer<typeof createMyReminderSchema>;
export type Reminder = z.infer<typeof reminderSchema>;
