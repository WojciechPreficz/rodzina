import { z } from 'zod';
import { DOCUMENT_TYPES } from '../documents.js';
import { calendarDateSchema } from './events.js';
import { reminderSchema, sharedDocumentReminderSchema } from './reminders.js';

export const documentTypeSchema = z.enum(DOCUMENT_TYPES);
export const documentStatusSchema = z.enum(['valid', 'expiring', 'expired']);
const documentFieldsSchema = z.object({
  type: documentTypeSchema,
  label: z.string().trim().min(1).max(200),
  holderUserId: z.string().uuid().nullable(),
  vehicleLabel: z.string().trim().min(1).max(200).nullable(),
  expiresOn: calendarDateSchema,
  notes: z.string().trim().max(10000).nullable(),
  reminders: z.array(sharedDocumentReminderSchema).max(20).optional(),
});

export const createDocumentSchema = documentFieldsSchema
  .partial({ holderUserId: true, vehicleLabel: true, notes: true })
  .strict();
export const patchDocumentSchema = documentFieldsSchema
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, 'Brak danych do zmiany.');

export const documentSchema = documentFieldsSchema.extend({
  reminders: z.array(reminderSchema),
  id: z.string().uuid(),
  familyId: z.string().uuid(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  status: documentStatusSchema,
});
export const documentsResponseSchema = z.object({ ok: z.literal(true), documents: z.array(documentSchema) });
export const documentResponseSchema = z.object({ ok: z.literal(true), document: documentSchema });
export const documentDeletedResponseSchema = z.object({ ok: z.literal(true), deleted: z.literal(true) });
export const renewDocumentSchema = z.object({ expiresOn: calendarDateSchema }).strict();
export type CreateDocument = z.infer<typeof createDocumentSchema>;
export type PatchDocument = z.infer<typeof patchDocumentSchema>;
export type FamilyDocument = z.infer<typeof documentSchema>;
