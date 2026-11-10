import { createContactService } from '../contacts/service.js';
import { createAuthRateLimitService } from './rate-limit-service.js';
import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../../config.js';
import type { DatabaseConnection } from '../../db/client.js';
import { hashPassword, hashToken, normalizeEmail, randomToken } from '../../auth.js';
import { ApiError } from '../../http/errors.js';
import { createAuthRepository } from './repository.js';
import type { RegisterFamilyInput } from './schemas.js';
import { sendRegistrationMail } from './registration-mail.js';

export class RegistrationRateLimitError extends ApiError {
  constructor(public retryAfter: number) {
    super(429, 'RATE_LIMITED', 'Za dużo prób rejestracji. Spróbuj ponownie później.');
  }
}

export function registerFamily(
  database: DatabaseConnection,
  values: Parameters<ReturnType<typeof createAuthRepository>['registerFamily']>[0],
) {
  database.db.transaction(
    () => {
      createAuthRepository(database).registerFamily(values);
      createContactService(database).initializeFamily(values.familyId, values.userId, values.now);
    },
    { behavior: 'immediate' },
  );
}

export function createRegistration(
  database: DatabaseConnection,
  config: AppConfig,
  logger: FastifyBaseLogger,
  sendMail = sendRegistrationMail,
) {
  const repository = createAuthRepository(database);
  const checkEnabled = () => {
    if (!config.RODZINA_ALLOW_REGISTRATION) throw new ApiError(403, 'FORBIDDEN', 'Rejestracja rodziny jest wyłączona.');
  };
  const limits = createAuthRateLimitService(database);
  const consume = database.sqlite.transaction((ip: string, email: string, now: number) => {
    repository.deleteExpiredRegistrations(now);
    const retryAfter = limits.consumeEmailAttempt('registration', ip, email, now);
    if (retryAfter) throw new RegistrationRateLimitError(retryAfter);
  });

  async function request(data: RegisterFamilyInput, ip: string) {
    checkEnabled();
    if (
      !config.RODZINA_SMTP_HOST ||
      !config.RODZINA_SMTP_USER ||
      !config.RODZINA_SMTP_PASSWORD ||
      !config.RODZINA_MAIL_FROM
    )
      throw new ApiError(503, 'UNAVAILABLE', 'Rejestracja jest chwilowo niedostępna. Spróbuj ponownie później.');
    const email = normalizeEmail(data.email);
    consume.immediate(ip, email, Date.now());
    if (repository.findUserByEmail(email))
      throw new ApiError(
        409,
        'CONFLICT',
        'Użytkownik z tym adresem e-mail już istnieje. Zaloguj się lub odzyskaj hasło.',
      );
    const passwordHash = await hashPassword(data.password);
    if (repository.findUserByEmail(email))
      throw new ApiError(409, 'CONFLICT', 'Konto z tym adresem już istnieje. Zaloguj się lub odzyskaj hasło.');
    const token = randomToken();
    const tokenHash = hashToken(token);
    const now = Date.now();
    const expiresAt = now + 24 * 60 * 60_000;
    repository.insertPendingRegistration({
      id: randomUUID(),
      tokenHash,
      email,
      familyName: data.familyName,
      displayName: data.displayName,
      passwordHash,
      createdAt: now,
      expiresAt,
    });
    try {
      const link = new URL('/potwierdz-rodzine', config.RODZINA_PUBLIC_URL);
      link.hash = new URLSearchParams({ token }).toString();
      await sendMail(config, { to: email, link: link.href, expiresAt });
      repository.markRegistrationReady(tokenHash);
    } catch {
      repository.removePendingRegistration(tokenHash);
      logger.error({ code: 'REGISTRATION_DELIVERY_FAILED' }, 'Registration delivery failed; new token invalidated.');
      throw new ApiError(
        503,
        'UNAVAILABLE',
        'Nie udało się wysłać potwierdzenia. Spróbuj ponownie później. Konto nie zostało utworzone.',
      );
    }
    return { ok: true as const };
  }

  const confirm = database.sqlite.transaction((token: string) => {
    checkEnabled();
    const now = Date.now();
    const pending = repository.findPendingRegistration(hashToken(token));
    if (!pending || !pending.ready || pending.expiresAt <= now)
      throw new ApiError(
        410,
        'EXPIRED',
        'Link jest nieprawidłowy, wygasł lub został już wykorzystany. Zaloguj się, jeśli konto zostało potwierdzone, albo ponów rejestrację.',
      );
    if (repository.findUserByEmail(pending.email))
      throw new ApiError(409, 'CONFLICT', 'Konto z tym adresem już istnieje. Zaloguj się lub odzyskaj hasło.');
    registerFamily(database, {
      familyId: randomUUID(),
      userId: randomUUID(),
      familyName: pending.familyName,
      displayName: pending.displayName,
      normalizedEmail: pending.email,
      passwordHash: pending.passwordHash,
      now,
    });
    repository.removeRegistrationsByEmail(pending.email);
    return { ok: true as const };
  });
  return {
    request,
    confirm: (token: string) => {
      repository.deleteExpiredRegistrations(Date.now());
      return confirm.immediate(token);
    },
  };
}
