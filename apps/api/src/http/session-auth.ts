import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, eq, gt } from 'drizzle-orm';
import {
  hashToken,
  isJsonMutation,
  isTrustedMutationSource,
  SESSION_REFRESH_INTERVAL_MS,
  SESSION_TTL_MS,
} from '../auth.js';
import type { AppConfig } from '../config.js';
import type { DatabaseConnection } from '../db/client.js';
import * as schema from '../db/schema.js';
import { ApiError, sendError } from './errors.js';
import { serializeUser, type PublicAuthUser } from './user.js';

function isPublicApiRequest(method: string, url: string): boolean {
  if (url === '/api/health') {
    return true;
  }

  if (method === 'POST' && url === '/api/auth/register-family') {
    return true;
  }

  if (method === 'POST' && url === '/api/auth/login') {
    return true;
  }

  if (method === 'POST' && url === '/api/auth/login-child') {
    return true;
  }

  if (method === 'GET' && url.startsWith('/api/auth/family-members')) {
    return true;
  }

  if ((method === 'GET' || method === 'POST') && url.startsWith('/api/invitations/')) {
    return true;
  }

  if (method === 'POST' && url === '/api/auth/reset-password') {
    return true;
  }

  return false;
}

export function requireUser(request: FastifyRequest): PublicAuthUser {
  if (!request.user || !request.familyId) throw new ApiError(401, 'UNAUTHORIZED', 'Brak aktywnej sesji.');
  return request.user;
}

export function registerSessionAuth(app: FastifyInstance, database: DatabaseConnection, config: AppConfig) {
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) {
      return;
    }

    if (isJsonMutation(request.method) && !isTrustedMutationSource(request.headers)) {
      return sendError(reply, 403, 'FORBIDDEN', 'Żądanie pochodzi z niezweryfikowanego źródła.');
    }

    if (isPublicApiRequest(request.method, request.url)) {
      return;
    }

    const rawSession = request.cookies?.sid;
    if (!rawSession) {
      return sendError(reply, 401, 'UNAUTHORIZED', 'Brak aktywnej sesji.');
    }

    const sessionHash = hashToken(rawSession);
    const now = Date.now();
    const sessionRecord = database.db
      .select()
      .from(schema.sessions)
      .where(and(eq(schema.sessions.id, sessionHash), gt(schema.sessions.expiresAt, now)))
      .get();

    if (!sessionRecord) {
      reply.clearCookie('sid', { path: '/' });
      return sendError(reply, 401, 'UNAUTHORIZED', 'Sesja wygasła lub jest nieprawidłowa.');
    }

    const userRecord = database.db.select().from(schema.users).where(eq(schema.users.id, sessionRecord.userId)).get();

    if (!userRecord) {
      reply.clearCookie('sid', { path: '/' });
      return sendError(reply, 401, 'UNAUTHORIZED', 'Użytkownik sesji nie istnieje.');
    }

    if (sessionRecord.expiresAt - now < SESSION_TTL_MS - SESSION_REFRESH_INTERVAL_MS) {
      database.db
        .update(schema.sessions)
        .set({ expiresAt: now + SESSION_TTL_MS })
        .where(eq(schema.sessions.id, sessionHash))
        .run();
      reply.setCookie('sid', rawSession, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: config.NODE_ENV === 'production',
        maxAge: SESSION_TTL_MS / 1000,
      });
    }

    request.user = serializeUser(userRecord);
    request.familyId = userRecord.familyId;
  });
}
