import type { FastifyReply } from 'fastify';
import { hashToken, randomToken, SESSION_TTL_MS } from '../../auth.js';
import type { AppConfig } from '../../config.js';
import type { DatabaseConnection } from '../../db/client.js';
import { createAuthRepository, type SessionCredential } from './repository.js';
import { ApiError } from '../../http/errors.js';

export function createSessionFactory(database: DatabaseConnection, config: AppConfig) {
  const repository = createAuthRepository(database);
  return async function createSession(
    reply: FastifyReply,
    request: { headers: Record<string, string | string[] | undefined> },
    userId: string,
    createdAt?: number,
    credential?: SessionCredential,
  ): Promise<void> {
    const sessionToken = randomToken();
    const sessionHash = hashToken(sessionToken);
    const now = createdAt ?? Date.now();
    const userAgent = Array.isArray(request.headers['user-agent'])
      ? request.headers['user-agent'][0]
      : request.headers['user-agent'];

    const inserted = repository.insertSession(
      {
        id: sessionHash,
        userId,
        expiresAt: now + SESSION_TTL_MS,
        createdAt: now,
        userAgent: userAgent ?? null,
      },
      credential,
    );
    if (!inserted) {
      const message =
        credential && 'pinHash' in credential
          ? 'Nieprawidłowy kod rodziny, użytkownik lub PIN.'
          : 'Nieprawidłowy e-mail lub hasło.';
      throw new ApiError(403, 'INVALID_CREDENTIALS', message);
    }

    reply.setCookie('sid', sessionToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 60,
    });
  };
}
