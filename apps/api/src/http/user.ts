import type { users } from '../db/schema.js';

export type PublicAuthUser = {
  id: string;
  familyId: string;
  displayName: string;
  email: string | null;
  role: 'admin' | 'member' | 'child';
  color: string;
  createdAt: number;
  updatedAt: number;
};

declare module 'fastify' {
  interface FastifyRequest {
    user?: PublicAuthUser;
    familyId?: string;
  }
}

export function serializeUser(user: Pick<typeof users.$inferSelect, keyof PublicAuthUser>): PublicAuthUser {
  return {
    id: user.id,
    familyId: user.familyId,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    color: user.color,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
