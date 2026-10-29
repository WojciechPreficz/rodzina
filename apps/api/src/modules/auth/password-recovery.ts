import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { eq, lte } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../../config.js';
import type { DatabaseConnection } from '../../db/client.js';
import { authRateLimits, passwordResets, users } from '../../db/schema.js';
import { hashToken, normalizeEmail, randomToken } from '../../auth.js';
import { ApiError } from '../../http/errors.js';
import { sendResetMail, SMTP_TIMEOUT_MS } from './reset-mail.js';

export const RESET_RESPONSE_DELAY_MS = SMTP_TIMEOUT_MS + 500;
export class RecoveryRateLimitError extends ApiError {
  constructor(public retryAfter: number) {
    super(429, 'RATE_LIMITED', 'Za dużo prób odzyskiwania hasła. Spróbuj ponownie później.');
  }
}

export function createPasswordRecovery(
  database: DatabaseConnection,
  config: AppConfig,
  logger: FastifyBaseLogger,
  sendMail = sendResetMail,
) {
  const consume = database.sqlite.transaction((ip: string, email: string, now: number) => {
    database.db.delete(authRateLimits).where(lte(authRateLimits.expiresAt, now)).run();
    const limits = [
      { key: hashToken(JSON.stringify(['reset-ip', ip])), max: 10, window: 15 * 60_000 },
      { key: hashToken(JSON.stringify(['reset-email', email])), max: 3, window: 60 * 60_000 },
    ].map((limit) => ({
      ...limit,
      record: database.db.select().from(authRateLimits).where(eq(authRateLimits.scopeKey, limit.key)).get(),
    }));
    const blocked = limits.filter(({ record, max }) => record && record.count >= max);
    if (blocked.length) return Math.max(...blocked.map(({ record }) => Math.ceil((record!.expiresAt - now) / 1000)));
    for (const { key, record, window } of limits) {
      const values = { scopeKey: key, count: (record?.count ?? 0) + 1, expiresAt: record?.expiresAt ?? now + window };
      database.db
        .insert(authRateLimits)
        .values(values)
        .onConflictDoUpdate({ target: authRateLimits.scopeKey, set: values })
        .run();
    }
    return 0;
  });

  return async (rawEmail: string, ip: string) => {
    if (!config.RODZINA_PASSWORD_RESET_EMAIL_ENABLED)
      throw new ApiError(503, 'UNAVAILABLE', 'Odzyskiwanie hasła przez e-mail jest niedostępne.');
    const email = normalizeEmail(rawEmail);
    const retryAfter = consume.immediate(ip, email, Date.now());
    if (retryAfter) throw new RecoveryRateLimitError(retryAfter);
    const started = performance.now();
    let tokenHash: string | undefined;
    try {
      const user = database.db.select().from(users).where(eq(users.email, email)).get();
      if (user?.passwordHash && user.role !== 'child') {
        const token = randomToken();
        tokenHash = hashToken(token);
        const expiresAt = Date.now() + 30 * 60_000;
        database.db.insert(passwordResets).values({ id: randomUUID(), userId: user.id, tokenHash, expiresAt }).run();
        await sendMail(config, {
          to: user.email!,
          link: new URL(`/reset-hasla/${token}`, config.RODZINA_PUBLIC_URL).href,
          expiresAt,
        });
      }
    } catch {
      if (tokenHash)
        database.db
          .update(passwordResets)
          .set({ usedAt: Date.now() })
          .where(eq(passwordResets.tokenHash, tokenHash))
          .run();
      // SMTP error messages can contain credentials, recipients or the message itself.
      logger.error(
        { code: 'PASSWORD_RESET_DELIVERY_FAILED' },
        'Password reset delivery failed; new token invalidated.',
      );
    } finally {
      // Give unknown accounts, fast delivery and SMTP timeouts the same response floor.
      await delay(Math.max(0, RESET_RESPONSE_DELAY_MS - (performance.now() - started)));
    }
    return { ok: true as const };
  };
}
