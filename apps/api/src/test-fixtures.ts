import { registerFamily as persistFamilyRegistration } from './modules/auth/registration.js';
import crypto from 'node:crypto';
import { buildApp } from './app.js';
import type { AppConfig } from './config.js';
import type { DatabaseConnection } from './db/client.js';
import { hashPassword, isValidPassword, normalizeEmail } from './auth.js';
import { ApiError } from './http/errors.js';
import { serializeFamily } from './http/family.js';
import { serializeUser } from './http/user.js';
import { parse } from './http/validation.js';
import { createAuthRepository } from './modules/auth/repository.js';
import { createSessionFactory } from './modules/auth/session.js';
import type { StartSession } from './modules/auth/service.js';
import { registerFamilySchema, type RegisterFamilyInput } from './modules/auth/schemas.js';

// Test fixtures only. This module is never imported by the production server.
export async function buildFixtureApp(
  config: AppConfig,
  database: DatabaseConnection,
  resetSender?: Parameters<typeof buildApp>[2],
  registrationSender?: Parameters<typeof buildApp>[3],
  invitationSender?: Parameters<typeof buildApp>[5],
) {
  const app = await buildApp(config, database, resetSender, registrationSender, undefined, invitationSender);
  const repository = createAuthRepository(database);
  const createSession = createSessionFactory(database, config);
  async function registerFamily(data: RegisterFamilyInput, startSession: StartSession) {
    if (!config.RODZINA_ALLOW_REGISTRATION) {
      throw new ApiError(403, 'FORBIDDEN', 'Rejestracja rodziny jest wyłączona.');
    }

    const { familyName, displayName, email, password } = data;
    const normalizedEmail = normalizeEmail(email);
    const existingUser = repository.findUserByEmail(normalizedEmail);

    if (existingUser) {
      throw new ApiError(409, 'CONFLICT', 'Użytkownik z tym adresem e-mail już istnieje.');
    }

    if (!isValidPassword(password)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Hasło musi mieć co najmniej 8 znaków.');
    }

    const familyId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const now = Date.now();
    const passwordHash = await hashPassword(password);
    try {
      persistFamilyRegistration(database, {
        familyId,
        userId,
        familyName,
        displayName,
        normalizedEmail,
        passwordHash,
        now,
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new ApiError(409, 'CONFLICT', 'Użytkownik z tym adresem e-mail już istnieje.');
      }
      throw error;
    }

    await startSession(userId, now);

    const family = repository.findFamily(familyId);
    const user = repository.findUser(userId);

    if (!family || !user) {
      throw new ApiError(500, 'INTERNAL_ERROR', 'Nie można odtworzyć rodziny lub użytkownika po rejestracji.');
    }

    return {
      ok: true,
      family: serializeFamily(family),
      user: serializeUser(user),
    };
  }

  app.post('/api/test/families', { config: { auth: 'public', idempotency: false } }, async (request, reply) => {
    return reply
      .code(201)
      .send(
        await registerFamily(parse(registerFamilySchema, request.body, 'Dane rejestracji są niepoprawne.'), (id, now) =>
          createSession(reply, request, id, now),
        ),
      );
  });
  return app;
}
