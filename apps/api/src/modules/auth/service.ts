import crypto from 'node:crypto';
import { z } from 'zod';
import { hashPassword, hashToken, isValidPassword, normalizeEmail, verifyPassword, verifyPin } from '../../auth.js';
import type { AppConfig } from '../../config.js';
import type { DatabaseConnection } from '../../db/client.js';
import { ApiError } from '../../http/errors.js';
import { serializeUser, type PublicAuthUser } from '../../http/user.js';
import { createAuthRepository } from './repository.js';

export type StartSession = (userId: string, createdAt?: number) => Promise<void>;
const registerFamilySchema = z.object({
  familyName: z.string().trim().min(2),
  displayName: z.string().trim().min(2),
  email: z.string().trim().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8),
});

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function getLoginRateLimitKey(ip: string, email: string): string {
  return `${ip}:${email}`;
}

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const existing = loginAttempts.get(key);

  if (!existing) {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }

  if (existing.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }

  if (existing.count >= 10) {
    return false;
  }

  existing.count += 1;
  loginAttempts.set(key, existing);
  return true;
}

function clearLoginRateLimit(key: string): void {
  loginAttempts.delete(key);
}

export function createAuthService(database: DatabaseConnection, config: AppConfig) {
  const repository = createAuthRepository(database);
  async function registerFamily(body: unknown, startSession: StartSession) {
    const parsed = registerFamilySchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Dane rejestracji są niepoprawne.');
    }

    if (!config.RODZINA_ALLOW_REGISTRATION) {
      throw new ApiError(403, 'FORBIDDEN', 'Rejestracja rodziny jest wyłączona.');
    }

    const { familyName, displayName, email, password } = parsed.data;
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
      family: {
        id: family.id,
        name: family.name,
        timezone: family.timezone,
        joinCode: family.joinCode,
      },
      user: serializeUser(user),
    };
  }

  async function login(body: unknown, ip: string, startSession: StartSession) {
    const parsed = loginSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Dane logowania są niepoprawne.');
    }

    const { email, password } = parsed.data;
    const normalizedEmail = normalizeEmail(email);
    const loginKey = getLoginRateLimitKey(ip, normalizedEmail);

    if (!checkRateLimit(loginKey)) {
      throw new ApiError(429, 'RATE_LIMITED', 'Za dużo prób logowania. Spróbuj ponownie później.');
    }

    const user = repository.findUserByEmail(normalizedEmail);
    if (!user || !user.passwordHash) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Nieprawidłowy e-mail lub hasło.');
    }

    const isValid = await verifyPassword(user.passwordHash, password);
    if (!isValid) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Nieprawidłowy e-mail lub hasło.');
    }

    clearLoginRateLimit(loginKey);

    await startSession(user.id, Date.now());

    const family = repository.findFamily(user.familyId);
    if (!family) {
      throw new ApiError(500, 'INTERNAL_ERROR', 'Nie można odczytać rodziny po zalogowaniu.');
    }

    return {
      ok: true,
      user: serializeUser(user),
      family: { id: family.id, name: family.name, timezone: family.timezone, joinCode: family.joinCode },
    };
  }

  async function familyMembers(query: unknown) {
    const joinCode = String((query as Record<string, unknown> | undefined)?.joinCode ?? '').trim();
    if (!joinCode) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Kod rodziny jest wymagany.');
    }

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

  async function loginChild(body: unknown, ip: string, startSession: StartSession) {
    const parsed = z
      .object({
        joinCode: z.string().trim().min(1),
        userId: z.string().trim().min(1),
        pin: z.string().trim().min(4).max(6),
      })
      .safeParse(body ?? {});

    if (!parsed.success) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Dane logowania dziecka są niepoprawne.');
    }

    const { joinCode, userId, pin } = parsed.data;
    const family = repository.findFamilyByCode(joinCode);
    if (!family) {
      throw new ApiError(404, 'NOT_FOUND', 'Nie znaleziono rodziny dla podanego kodu.');
    }

    const user = repository.findChild(family.id, userId);

    if (!user || !user.pinHash) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Nieprawidłowy kod rodziny, użytkownik lub PIN.');
    }

    const loginKey = getLoginRateLimitKey(ip, `${family.id}:${userId}`);
    if (!checkRateLimit(loginKey)) {
      throw new ApiError(429, 'RATE_LIMITED', 'Za dużo prób logowania. Spróbuj ponownie później.');
    }

    const isValid = await verifyPin(user.pinHash, pin);
    if (!isValid) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Nieprawidłowy kod rodziny, użytkownik lub PIN.');
    }

    clearLoginRateLimit(loginKey);
    await startSession(user.id);

    return {
      ok: true,
      user: serializeUser(user),
      family: { id: family.id, name: family.name, timezone: family.timezone, joinCode: family.joinCode },
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
      family: { id: family.id, name: family.name, timezone: family.timezone, joinCode: family.joinCode },
    };
  }

  async function resetPassword(body: unknown) {
    const parsed = z
      .object({
        token: z.string().trim().min(1),
        password: z.string().min(8),
      })
      .safeParse(body ?? {});

    if (!parsed.success) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Dane resetu hasła są niepoprawne.');
    }

    const { token, password } = parsed.data;
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
