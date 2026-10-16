import { z } from 'zod';

const endpointSchema = z
  .string()
  .max(4096)
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
    } catch {
      return false;
    }
  });
const keySchema = (length: number) =>
  z
    .string()
    .length(length)
    .regex(/^[A-Za-z0-9_-]+$/);

export const pushSubscriptionSchema = z
  .object({
    endpoint: endpointSchema,
    keys: z.object({ p256dh: keySchema(87), auth: keySchema(22) }).strict(),
    expirationTime: z.number().nonnegative().nullable().optional(),
  })
  .strict();
export const deletePushSubscriptionSchema = z.object({ endpoint: endpointSchema }).strict();
export const pushStatusQuerySchema = z.object({ endpoint: endpointSchema.optional() }).strict();
export const pushStatusResponseSchema = z
  .object({ ok: z.literal(true), subscribed: z.boolean(), hasReminders: z.boolean() })
  .strict();
export const pushPublicKeyResponseSchema = z.object({ ok: z.literal(true), publicKey: z.string() }).strict();
export const pushMutationResponseSchema = z.object({ ok: z.literal(true) }).strict();
export const pushTestResponseSchema = z
  .object({
    ok: z.literal(true),
    sent: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
  })
  .strict();
