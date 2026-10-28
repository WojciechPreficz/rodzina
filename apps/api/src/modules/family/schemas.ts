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
export const acceptInvitationSchema = z.object({
  displayName: z.string().trim().min(2),
  email: z.string().trim().email(),
  password: z.string().min(8),
});
export const updateMemberSchema = z.object({
  displayName: z.string().trim().min(2).optional(),
  color: colorSchema.optional(),
  role: z.enum(['admin', 'member', 'child']).optional(),
  pin: z.string().trim().min(4).max(6).optional(),
});
export const updateFamilySchema = z.object({ name: z.string().trim().min(2) });

export type CreateChildInput = z.infer<typeof createChildSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type UpdateFamilyInput = z.infer<typeof updateFamilySchema>;
