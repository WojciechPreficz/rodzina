import { randomUUID } from 'node:crypto';
import { eq, lte } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../../config.js';
import type { DatabaseConnection } from '../../db/client.js';
import { authRateLimits, pendingRegistrations } from '../../db/schema.js';
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
  const cleanup = (now: number) =>
    database.db.delete(pendingRegistrations).where(lte(pendingRegistrations.expiresAt, now)).run();
  const consume = database.sqlite.transaction((ip: string, email: string, now: number) => {
    cleanup(now);
    database.db.delete(authRateLimits).where(lte(authRateLimits.expiresAt, now)).run();
    const limits = [
      { key: hashToken(JSON.stringify(['registration-ip', ip])), max: 10, window: 15 * 60_000 },
      { key: hashToken(JSON.stringify(['registration-email', email])), max: 3, window: 60 * 60_000 },
    ].map((limit) => ({
      ...limit,
      record: database.db.select().from(authRateLimits).where(eq(authRateLimits.scopeKey, limit.key)).get(),
    }));
    const blocked = limits.filter(({ record, max }) => record && record.count >= max);
    if (blocked.length)
      throw new RegistrationRateLimitError(
        Math.max(...blocked.map(({ record }) => Math.ceil((record!.expiresAt - now) / 1000))),
      );
    for (const { key, record, window } of limits) {
      const values = { scopeKey: key, count: (record?.count ?? 0) + 1, expiresAt: record?.expiresAt ?? now + window };
      database.db
        .insert(authRateLimits)
        .values(values)
        .onConflictDoUpdate({ target: authRateLimits.scopeKey, set: values })
        .run();
    }
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
    database.db
      .insert(pendingRegistrations)
      .values({
        id: randomUUID(),
        tokenHash,
        email,
        familyName: data.familyName,
        displayName: data.displayName,
        passwordHash,
        createdAt: now,
        expiresAt,
      })
      .run();
    try {
      const link = new URL('/potwierdz-rodzine', config.RODZINA_PUBLIC_URL);
      link.hash = new URLSearchParams({ token }).toString();
      await sendMail(config, { to: email, link: link.href, expiresAt });
      database.db
        .update(pendingRegistrations)
        .set({ ready: true })
        .where(eq(pendingRegistrations.tokenHash, tokenHash))
        .run();
    } catch {
      database.db.delete(pendingRegistrations).where(eq(pendingRegistrations.tokenHash, tokenHash)).run();
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
    const pending = database.db
      .select()
      .from(pendingRegistrations)
      .where(eq(pendingRegistrations.tokenHash, hashToken(token)))
      .get();
    if (!pending || !pending.ready || pending.expiresAt <= now)
      throw new ApiError(
        410,
        'EXPIRED',
        'Link jest nieprawidłowy, wygasł lub został już wykorzystany. Zaloguj się, jeśli konto zostało potwierdzone, albo ponów rejestrację.',
      );
    if (repository.findUserByEmail(pending.email))
      throw new ApiError(409, 'CONFLICT', 'Konto z tym adresem już istnieje. Zaloguj się lub odzyskaj hasło.');
    repository.registerFamily({
      familyId: randomUUID(),
      userId: randomUUID(),
      familyName: pending.familyName,
      displayName: pending.displayName,
      normalizedEmail: pending.email,
      passwordHash: pending.passwordHash,
      now,
    });
    database.db.delete(pendingRegistrations).where(eq(pendingRegistrations.email, pending.email)).run();
    return { ok: true as const };
  });
  return {
    request,
    confirm: (token: string) => {
      cleanup(Date.now());
      return confirm.immediate(token);
    },
  };
}
