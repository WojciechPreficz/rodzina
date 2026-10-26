import { createHash } from 'node:crypto';
import type { DatabaseConnection } from '../../db/client.js';
import { ApiError } from '../../http/errors.js';
import { createAuthRateLimitRepository } from './rate-limit-repository.js';

export const LOGIN_RATE_LIMIT = 10;
export const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000;

export function createLoginRateLimitKey(scope: 'password' | 'child', ip: string, ...identifiers: string[]) {
  return createHash('sha256')
    .update(JSON.stringify([scope, ip, ...identifiers]))
    .digest('hex');
}

export function createAuthRateLimitService(database: DatabaseConnection) {
  const repository = createAuthRateLimitRepository(database);
  return {
    consume(key: string) {
      if (!repository.consume(key, Date.now(), LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS)) {
        throw new ApiError(429, 'RATE_LIMITED', 'Za dużo prób logowania. Spróbuj ponownie później.');
      }
    },
    clear: repository.clear,
  };
}
