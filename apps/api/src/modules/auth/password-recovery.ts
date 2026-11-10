import { createAuthRepository } from './repository.js';
import { createAuthRateLimitService } from './rate-limit-service.js';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../../config.js';
import type { DatabaseConnection } from '../../db/client.js';
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
  const repository = createAuthRepository(database);
  const limits = createAuthRateLimitService(database);

  return async (rawEmail: string, ip: string) => {
    if (!config.RODZINA_PASSWORD_RESET_EMAIL_ENABLED)
      throw new ApiError(503, 'UNAVAILABLE', 'Odzyskiwanie hasła przez e-mail jest niedostępne.');
    const email = normalizeEmail(rawEmail);
    const retryAfter = limits.consumeEmailAttempt('reset', ip, email, Date.now());
    if (retryAfter) throw new RecoveryRateLimitError(retryAfter);
    const started = performance.now();
    let tokenHash: string | undefined;
    try {
      const user = repository.findUserByEmail(email);
      if (user?.passwordHash && user.role !== 'child') {
        const token = randomToken();
        tokenHash = hashToken(token);
        const expiresAt = Date.now() + 30 * 60_000;
        repository.insertPasswordReset({ id: randomUUID(), userId: user.id, tokenHash, expiresAt });
        await sendMail(config, {
          to: user.email!,
          link: new URL(`/reset-hasla/${token}`, config.RODZINA_PUBLIC_URL).href,
          expiresAt,
        });
      }
    } catch {
      if (tokenHash) repository.invalidatePasswordReset(tokenHash, Date.now());
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
