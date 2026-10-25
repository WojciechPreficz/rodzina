import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => value || null);
const contactFields = z.object({
  name: z.string().trim().min(1).max(120),
  groupId: z.string().uuid(),
  address: optionalText(1000),
  phone: optionalText(50),
  relationship: optionalText(120),
});
const metadata = {
  id: z.string().uuid(),
  familyId: z.string().uuid(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
};
export const createContactSchema = contactFields
  .partial({ groupId: true, address: true, phone: true, relationship: true })
  .strict();
export const patchContactSchema = contactFields
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, 'Brak danych do zmiany.');
export const createContactGroupSchema = z.object({ name: z.string().trim().min(1).max(60) }).strict();
export const patchContactGroupSchema = createContactGroupSchema;
export const contactSchema = contactFields.extend(metadata);
export const contactGroupSchema = createContactGroupSchema.extend({ ...metadata, isDefault: z.boolean() });
export const contactsResponseSchema = z.object({
  ok: z.literal(true),
  groups: z.array(contactGroupSchema),
  contacts: z.array(contactSchema),
});
export const contactResponseSchema = z.object({ ok: z.literal(true), contact: contactSchema });
export const contactGroupResponseSchema = z.object({ ok: z.literal(true), group: contactGroupSchema });
export const contactDeletedResponseSchema = z.object({ ok: z.literal(true), deleted: z.literal(true) });
export type Contact = z.infer<typeof contactSchema>;
export type ContactGroup = z.infer<typeof contactGroupSchema>;
export type CreateContact = z.infer<typeof createContactSchema>;
export type PatchContact = z.infer<typeof patchContactSchema>;
