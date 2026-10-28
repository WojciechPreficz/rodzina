import { serializeFamily } from '../../http/family.js';
import crypto from 'node:crypto';
import type { RegisterFamilyInput, LoginInput, LoginChildInput, ResetPasswordInput } from './schemas.js';
import { hashPassword, hashToken, isValidPassword, normalizeEmail, verifyPassword, verifyPin } from '../../auth.js';
import type { AppConfig } from '../../config.js';
import type { DatabaseConnection } from '../../db/client.js';
import { ApiError } from '../../http/errors.js';
import { serializeUser, type PublicAuthUser } from '../../http/user.js';
import { createAuthRepository } from './repository.js';
import { createAuthRateLimitService, createLoginRateLimitKey } from './rate-limit-service.js';

export type StartSession = (userId: string, createdAt?: number) => Promise<void>;
export function createAuthService(database: DatabaseConnection, config: AppConfig) {
  const repository = createAuthRepository(database);
  const rateLimits = createAuthRateLimitService(database);
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
      repository.registerFamily({ familyId, userId, familyName, displayName, normalizedEmail, passwordHash, now });
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

  async function login(data: LoginInput, ip: string, startSession: StartSession) {
    const { email, password } = data;
    const normalizedEmail = normalizeEmail(email);
    const loginKey = createLoginRateLimitKey('password', ip, normalizedEmail);
    rateLimits.consume(loginKey);

    const user = repository.findUserByEmail(normalizedEmail);
    if (!user || !user.passwordHash) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Nieprawidłowy e-mail lub hasło.');
    }

    const isValid = await verifyPassword(user.passwordHash, password);
    if (!isValid) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Nieprawidłowy e-mail lub hasło.');
    }

    rateLimits.clear(loginKey);

    await startSession(user.id, Date.now());

    const family = repository.findFamily(user.familyId);
    if (!family) {
      throw new ApiError(500, 'INTERNAL_ERROR', 'Nie można odczytać rodziny po zalogowaniu.');
    }

    return {
      ok: true,
      user: serializeUser(user),
      family: serializeFamily(family),
    };
  }

  async function familyMembers(joinCode: string) {
    const family = repository.findFamilyByCode(joinCode);
    if (!family) {
      throw new ApiError(404, 'NOT_FOUND', 'Nie znaleziono rodziny dla podanego kodu.');
    }

    const children = repository.listChildren(family.id);

    return {
      ok: true,
      members: children,
      children,
    };
  }

  async function loginChild(data: LoginChildInput, ip: string, startSession: StartSession) {
    const { joinCode, userId, pin } = data;
    const family = repository.findFamilyByCode(joinCode);
    if (!family) {
      throw new ApiError(404, 'NOT_FOUND', 'Nie znaleziono rodziny dla podanego kodu.');
    }

    const user = repository.findChild(family.id, userId);

    if (!user || !user.pinHash) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Nieprawidłowy kod rodziny, użytkownik lub PIN.');
    }

    const loginKey = createLoginRateLimitKey('child', ip, family.id, userId);
    rateLimits.consume(loginKey);

    const isValid = await verifyPin(user.pinHash, pin);
    if (!isValid) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Nieprawidłowy kod rodziny, użytkownik lub PIN.');
    }

    rateLimits.clear(loginKey);
    await startSession(user.id);

    return {
      ok: true,
      user: serializeUser(user),
      family: serializeFamily(family),
    };
  }

  async function logout(sessionToken: string | undefined) {
    if (sessionToken) {
      repository.deleteSession(hashToken(sessionToken));
    }

    return { ok: true };
  }

  async function me(user: PublicAuthUser) {
    const family = repository.findFamily(user.familyId);
    if (!family) {
      throw new ApiError(500, 'INTERNAL_ERROR', 'Brak danych rodziny dla aktywnego użytkownika.');
    }

    return {
      ok: true,
      user,
      family: serializeFamily(family),
    };
  }

  async function resetPassword(data: ResetPasswordInput) {
    const { token, password } = data;
    const resetRequest = repository.findPasswordReset(hashToken(token));

    if (!resetRequest) {
      throw new ApiError(404, 'NOT_FOUND', 'Token resetu hasła jest nieprawidłowy.');
    }

    if (resetRequest.expiresAt <= Date.now()) {
      throw new ApiError(410, 'EXPIRED', 'Token resetu hasła wygasł.');
    }

    if (resetRequest.usedAt) {
      throw new ApiError(410, 'USED', 'Token resetu hasła został już wykorzystany.');
    }

    if (!isValidPassword(password)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Hasło musi mieć co najmniej 8 znaków.');
    }

    const passwordHash = await hashPassword(password);
    const now = Date.now();

    const reset = repository.resetPassword(resetRequest, passwordHash, now);
    if (!reset) {
      throw new ApiError(410, 'USED', 'Token resetu hasła wygasł lub został już wykorzystany.');
    }

    return { ok: true };
  }
  return { registerFamily, login, familyMembers, loginChild, logout, me, resetPassword };
}
