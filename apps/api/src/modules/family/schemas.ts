import { z } from 'zod';

const colorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/);
export const createChildSchema = z.object({
  displayName: z.string().trim().min(2),
  pin: z.string().trim().min(4).max(6),
  color: colorSchema.optional(),
});
export const createInvitationSchema = z.object({ role: z.enum(['admin', 'member']) });
export const invitationParamsSchema = z.object({ token: z.string().min(1) });
export const memberParamsSchema = z.object({ id: z.string().min(1) });
export const invitationEmailSchema = z.object({ email: z.string().trim().max(254).email() });
export const verifiedInvitationSchema = z.object({
  displayName: z.string().trim().min(2),
  password: z.string().min(8).max(1024),
  emailVerificationToken: z.string().regex(/^[a-f0-9]{64}$/),
});
export const acceptInvitationSchema = z.union([
  verifiedInvitationSchema,
  verifiedInvitationSchema.omit({ emailVerificationToken: true }).merge(invitationEmailSchema).extend({
    emailVerificationToken: z.never().optional(),
  }),
]);
export const updateMemberSchema = z.object({
  displayName: z.string().trim().min(2).optional(),
  color: colorSchema.optional(),
  role: z.enum(['admin', 'member', 'child']).optional(),
  pin: z.string().trim().min(4).max(6).optional(),
});
export const updateFamilySchema = z.object({ name: z.string().trim().min(2) });

export type CreateChildInput = z.infer<typeof createChildSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type VerifiedInvitationInput = z.infer<typeof verifiedInvitationSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type UpdateFamilyInput = z.infer<typeof updateFamilySchema>;
