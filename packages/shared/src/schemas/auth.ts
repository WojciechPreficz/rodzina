import { z } from 'zod';

export const roleSchema = z.enum(['admin', 'member', 'child']);
export const publicUserSchema = z.object({
  id: z.string(),
  familyId: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  role: roleSchema,
  color: z.string(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export const familySchema = z.object({
  id: z.string(),
  name: z.string(),
  timezone: z.string(),
  joinCode: z.string(),
});
export const sessionResponseSchema = z.object({
  ok: z.literal(true),
  user: publicUserSchema,
  family: familySchema,
});
export const authMeResponseSchema = sessionResponseSchema;
export const loginResponseSchema = sessionResponseSchema;
export const loginChildResponseSchema = sessionResponseSchema;
export const registerFamilyResponseSchema = sessionResponseSchema;
export const acceptInvitationResponseSchema = sessionResponseSchema;
export const membersResponseSchema = z.object({ ok: z.literal(true), members: z.array(publicUserSchema) });
export const memberResponseSchema = z.object({ ok: z.literal(true), member: publicUserSchema });
export const childProfileSchema = publicUserSchema.pick({ id: true, displayName: true, color: true });
export const familyMembersResponseSchema = z.object({
  ok: z.literal(true),
  members: z.array(childProfileSchema),
  children: z.array(childProfileSchema),
});
const invitationSchema = z.object({
  id: z.string(),
  role: z.enum(['admin', 'member']),
  expiresAt: z.number().int(),
});
export const createInvitationResponseSchema = z.object({
  ok: z.literal(true),
  invitation: invitationSchema,
  token: z.string(),
  link: z.string(),
});
export const invitationResponseSchema = z.object({
  ok: z.literal(true),
  family: familySchema.pick({ id: true, name: true }),
  invitation: invitationSchema,
});
export const familyResponseSchema = z.object({ ok: z.literal(true), family: familySchema });
export const rotateJoinCodeResponseSchema = z.object({ ok: z.literal(true), joinCode: z.string() });
export const passwordResetLinkResponseSchema = z.object({
  ok: z.literal(true),
  token: z.string(),
  link: z.string(),
  expiresAt: z.number().int(),
});
export const authOkResponseSchema = z.object({ ok: z.literal(true) });
export const passwordResetResponseSchema = authOkResponseSchema.extend({ resetOwnSession: z.boolean() });
export const passwordRecoveryAvailabilitySchema = z.object({ enabled: z.boolean() });
export const forgotPasswordInputSchema = z.object({ email: z.string().trim().email().max(254) });
export const deleteMemberResponseSchema = z.object({ ok: z.literal(true), deleted: z.literal(true) });

export type AuthRole = z.infer<typeof roleSchema>;
export type AuthUser = z.infer<typeof publicUserSchema>;
export type Member = AuthUser;
export type Family = z.infer<typeof familySchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type AuthMeResponse = z.infer<typeof authMeResponseSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type LoginChildResponse = z.infer<typeof loginChildResponseSchema>;
export type RegisterFamilyResponse = z.infer<typeof registerFamilyResponseSchema>;
export type AcceptInvitationResponse = z.infer<typeof acceptInvitationResponseSchema>;
export type MembersResponse = z.infer<typeof membersResponseSchema>;
export type MemberResponse = z.infer<typeof memberResponseSchema>;
export type ChildProfile = z.infer<typeof childProfileSchema>;
export type FamilyMembersResponse = z.infer<typeof familyMembersResponseSchema>;
export type CreateInvitationResponse = z.infer<typeof createInvitationResponseSchema>;
export type InvitationResponse = z.infer<typeof invitationResponseSchema>;
export type FamilyResponse = z.infer<typeof familyResponseSchema>;
export type RotateJoinCodeResponse = z.infer<typeof rotateJoinCodeResponseSchema>;
export type PasswordResetLinkResponse = z.infer<typeof passwordResetLinkResponseSchema>;
export type AuthOkResponse = z.infer<typeof authOkResponseSchema>;
export type DeleteMemberResponse = z.infer<typeof deleteMemberResponseSchema>;
