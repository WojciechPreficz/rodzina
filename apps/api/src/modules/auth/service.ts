import { serializeFamily } from '../../http/family.js';
import type { LoginInput, LoginChildInput, ResetPasswordInput } from './schemas.js';
import { hashPassword, hashToken, isValidPassword, normalizeEmail, verifyPassword, verifyPin } from '../../auth.js';
import type { DatabaseConnection } from '../../db/client.js';
import { ApiError } from '../../http/errors.js';
import { serializeUser, type PublicAuthUser } from '../../http/user.js';
import { createAuthRepository, type SessionCredential } from './repository.js';
import { createAuthRateLimitService, createLoginRateLimitKey } from './rate-limit-service.js';

export type StartSession = (userId: string, createdAt?: number, credential?: SessionCredential) => Promise<void>;
export function createAuthService(database: DatabaseConnection) {
  const repository = createAuthRepository(database);
  const rateLimits = createAuthRateLimitService(database);
  async function login(data: LoginInput, ip: string, startSession: StartSession) {
    const { email, password } = data;
    const normalizedEmail = normalizeEmail(email);
    const loginKey = createLoginRateLimitKey('password', ip, normalizedEmail);
    rateLimits.consume(loginKey);

    const user = repository.findUserByEmail(normalizedEmail);
    if (!user || !user.passwordHash) {
      throw new ApiError(403, 'INVALID_CREDENTIALS', 'Nieprawidłowy e-mail lub hasło.');
    }

    const isValid = await verifyPassword(user.passwordHash, password);
    if (!isValid) {
      throw new ApiError(403, 'INVALID_CREDENTIALS', 'Nieprawidłowy e-mail lub hasło.');
    }

    rateLimits.clear(loginKey);

    await startSession(user.id, Date.now(), { passwordHash: user.passwordHash });

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

  function familyMembers(joinCode: string, ip: string) {
    const children = rateLimits.lookupFamily(ip, () => repository.listChildren(joinCode));
    if (!children.length) {
      throw new ApiError(404, 'NOT_FOUND', 'Nie znaleziono profili dzieci dla podanego kodu.');
    }

    return {
      ok: true,
      members: children,
      children,
    };
  }

  async function loginChild(data: LoginChildInput, ip: string, startSession: StartSession) {
    const { joinCode, userId, pin } = data;
    const child = repository.findChild(joinCode, userId);
    if (!child?.user.pinHash) {
      throw new ApiError(403, 'INVALID_CREDENTIALS', 'Nieprawidłowy kod rodziny, użytkownik lub PIN.');
    }

    const { user, family } = child;
    const pinHash = child.user.pinHash;
    const attempt = rateLimits.reserveChildPin(ip, userId, pinHash);
    const isValid = await verifyPin(pinHash, pin).catch((error: unknown) => {
      attempt.release();
      throw error;
    });
    if (!isValid) {
      throw new ApiError(403, 'INVALID_CREDENTIALS', 'Nieprawidłowy kod rodziny, użytkownik lub PIN.');
    }

    attempt.release();
    await startSession(user.id, Date.now(), { pinHash, joinCode });
    attempt.clearIp();

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

  async function resetPassword(data: ResetPasswordInput, sessionToken?: string) {
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
    const resetOwnSession =
      !!sessionToken && repository.sessionBelongsTo(hashToken(sessionToken), resetRequest.userId, now);

    const reset = repository.resetPassword(resetRequest, passwordHash, now);
    if (!reset) {
      throw new ApiError(410, 'USED', 'Token resetu hasła wygasł lub został już wykorzystany.');
    }

    return { ok: true, resetOwnSession };
  }
  return { login, familyMembers, loginChild, logout, me, resetPassword };
}
