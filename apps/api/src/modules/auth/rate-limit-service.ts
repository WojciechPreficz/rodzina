import { hashToken } from '../../auth.js';
import type { DatabaseConnection } from '../../db/client.js';
import { ApiError } from '../../http/errors.js';
import { createAuthRateLimitRepository } from './rate-limit-repository.js';

export const LOGIN_RATE_LIMIT = 10;
export const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;
export const FAMILY_LOOKUP_IP_LIMIT = 10;
export const FAMILY_LOOKUP_FAILURE_LIMIT = 100;
export const CHILD_PIN_LIMIT = 20;
export const CHILD_PIN_WINDOW_MS = 60 * 60_000;

export function createLoginRateLimitKey(scope: 'password' | 'child', ...identifiers: string[]) {
  return rateLimitKey(scope, ...identifiers);
}

function rateLimitKey(scope: string, ...identifiers: string[]) {
  return hashToken(JSON.stringify([scope, ...identifiers]));
}

export class AuthRateLimitError extends ApiError {
  constructor(
    public retryAfter: number,
    message: string,
  ) {
    super(429, 'RATE_LIMITED', message);
  }
}

export function createAuthRateLimitService(database: DatabaseConnection) {
  const repository = createAuthRateLimitRepository(database);
  const loginMessage = 'Za dużo prób logowania. Spróbuj ponownie później.';
  const lookupMessage = 'Za dużo prób wyszukania profili. Spróbuj ponownie później.';
  const globalLookupKey = rateLimitKey('family-lookup-global');
  return {
    consume(key: string) {
      if (!repository.consume(key, Date.now(), LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS)) {
        throw new ApiError(429, 'RATE_LIMITED', loginMessage);
      }
    },
    consumeEmailAttempt(scope: 'registration' | 'reset', ip: string, email: string, now: number) {
      return repository.consumeAll(
        [
          { key: rateLimitKey(scope + '-ip', ip), max: 10, windowMs: 15 * 60_000 },
          { key: rateLimitKey(scope + '-email', email), max: 3, windowMs: 60 * 60_000 },
        ],
        now,
      );
    },
    consumeDeletionAttempt(userId: string, now: number) {
      const key = rateLimitKey('account-deletion', userId);
      return repository.consumeAll([{ key, max: 10, windowMs: 15 * 60_000 }], now);
    },
    clearDeletionAttempts: (userId: string) => repository.clear(rateLimitKey('account-deletion', userId)),
    deleteExpired: repository.deleteExpired,
    clear: repository.clear,
    lookupFamily<T>(ip: string, lookup: () => T[]) {
      return database.sqlite
        .transaction(() => {
          const now = Date.now();
          const ipKey = rateLimitKey('family-lookup-ip', ip);
          const retryAfter = Math.max(
            repository.retryAfter(globalLookupKey, now, FAMILY_LOOKUP_FAILURE_LIMIT),
            repository.retryAfter(ipKey, now, FAMILY_LOOKUP_IP_LIMIT),
          );
          if (retryAfter) throw new AuthRateLimitError(retryAfter, lookupMessage);

          repository.consume(ipKey, now, FAMILY_LOOKUP_IP_LIMIT, LOGIN_RATE_WINDOW_MS);
          const children = lookup();
          if (!children.length)
            repository.consume(globalLookupKey, now, FAMILY_LOOKUP_FAILURE_LIMIT, LOGIN_RATE_WINDOW_MS);
          return children;
        })
        .immediate();
    },
    reserveChildPin(ip: string, childId: string, pinHash: string) {
      // A PIN change gives the child fresh limits on every IP.
      const childKey = rateLimitKey('child-pin', childId, pinHash);
      const ipKey = createLoginRateLimitKey('child', ip, childId, pinHash);
      const expiresAt = database.sqlite
        .transaction(() => {
          const now = Date.now();
          const childRetry = repository.retryAfter(childKey, now, CHILD_PIN_LIMIT);
          if (childRetry)
            throw new AuthRateLimitError(
              childRetry,
              'Za dużo prób podania PIN-u. Spróbuj ponownie później lub poproś administratora o zmianę PIN-u.',
            );
          const ipRetry = repository.retryAfter(ipKey, now, LOGIN_RATE_LIMIT);
          if (ipRetry) throw new AuthRateLimitError(ipRetry, loginMessage);

          repository.consume(ipKey, now, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS);
          return repository.reserve(childKey, now, CHILD_PIN_LIMIT, CHILD_PIN_WINDOW_MS)!;
        })
        .immediate();
      return {
        release: () => repository.release(childKey, expiresAt),
        clearIp: () => repository.clear(ipKey),
      };
    },
  };
}
