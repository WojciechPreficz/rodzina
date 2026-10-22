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
export const sharedTaskReminderSchema = z.discriminatedUnion('type', [
  offset.extend({ audience: z.enum(['owner', 'list_members']).default('owner') }).strict(),
  absolute.extend({ audience: z.enum(['owner', 'list_members']).default('owner') }).strict(),
]);
export const sharedDocumentReminderSchema = z.discriminatedUnion('type', [
  offset.extend({ audience: z.enum(['family', 'adults', 'owner']).default('adults') }).strict(),
  absolute.extend({ audience: z.enum(['family', 'adults', 'owner']).default('adults') }).strict(),
]);
const sourceFields = {
  eventId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  documentId: z.string().uuid().optional(),
};
const oneSource = (data: {
  eventId?: string | undefined;
  taskId?: string | undefined;
  documentId?: string | undefined;
}) => Number(!!data.eventId) + Number(!!data.taskId) + Number(!!data.documentId) === 1;
export const myRemindersQuerySchema = z.object(sourceFields).strict().refine(oneSource, 'Wybierz jedno źródło.');
export const createMyReminderSchema = z
  .discriminatedUnion('type', [offset.extend(sourceFields).strict(), absolute.extend(sourceFields).strict()])
  .refine(oneSource, 'Wybierz jedno źródło.');
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
  audience: z.enum(['participants', 'family', 'adults', 'owner', 'user', 'list_members']),
  userId: z.string().uuid().nullable(),
  createdBy: z.string().uuid().nullable(),
  nextFireAt: timestamp.nullable(),
  lastSentAt: timestamp.nullable(),
});
export const reminderResponseSchema = z.object({ ok: z.literal(true), reminder: reminderSchema });
export const myRemindersResponseSchema = z.object({ ok: z.literal(true), reminders: z.array(reminderSchema) });
export const deleteReminderResponseSchema = z.object({ ok: z.literal(true), deleted: z.literal(true) });
export type SharedEventReminder = z.infer<typeof sharedEventReminderSchema>;
export type SharedTaskReminder = z.infer<typeof sharedTaskReminderSchema>;
export type SharedDocumentReminder = z.infer<typeof sharedDocumentReminderSchema>;
export type MyReminderSource = z.infer<typeof myRemindersQuerySchema>;
export type CreateMyReminder = z.infer<typeof createMyReminderSchema>;
export type Reminder = z.infer<typeof reminderSchema>;
