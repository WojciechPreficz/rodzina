import { z } from 'zod';

export const registerFamilySchema = z.object({
  familyName: z.string().trim().min(2).max(200),
  displayName: z.string().trim().min(2).max(200),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(1024),
});
export const loginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(8) });
export const familyMembersQuerySchema = z.object({ joinCode: z.string().trim().min(1) });
export const loginChildSchema = z.object({
  joinCode: z.string().trim().min(1),
  userId: z.string().trim().min(1),
  pin: z.string().trim().min(4).max(6),
});
export const resetPasswordSchema = z.object({
  token: z.string().trim().min(1),
  password: z.string().min(8),
});

export type RegisterFamilyInput = z.infer<typeof registerFamilySchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type LoginChildInput = z.infer<typeof loginChildSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
