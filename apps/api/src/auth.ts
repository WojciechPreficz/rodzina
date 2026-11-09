import crypto from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { hash as hashArgon2, verify as verifyArgon2 } from '@node-rs/argon2';
import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from '@rodzina/shared';

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 60;
export const SESSION_REFRESH_INTERVAL_MS = 1000 * 60 * 60 * 24;

export function hashToken(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function generateJoinCode(isTaken: (code: string) => boolean): string {
  let code: string;
  do {
    code = Array.from(
      { length: JOIN_CODE_LENGTH },
      () => JOIN_CODE_ALPHABET[crypto.randomInt(JOIN_CODE_ALPHABET.length)],
    ).join('');
  } while (isTaken(code));
  return code;
}

const ARGON2_CONCURRENCY = 2;
let activeArgon2Jobs = 0;
const waitingArgon2Jobs: Array<() => void> = [];

async function withArgon2Slot<T>(operation: () => Promise<T>): Promise<T> {
  if (activeArgon2Jobs < ARGON2_CONCURRENCY) {
    activeArgon2Jobs++;
  } else {
    await new Promise<void>((resolve) => waitingArgon2Jobs.push(resolve));
  }
  try {
    return await operation();
  } finally {
    const next = waitingArgon2Jobs.shift();
    if (next) next();
    else activeArgon2Jobs--;
  }
}

export function hashPassword(value: string): Promise<string> {
  return withArgon2Slot(() => hashArgon2(value, { parallelism: 1, memoryCost: 65536, timeCost: 3 }));
}

export function hashPin(value: string): Promise<string> {
  return hashPassword(value);
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return withArgon2Slot(() => verifyArgon2(hash, password));
}

export function verifyPin(hash: string, pin: string): Promise<boolean> {
  return verifyPassword(hash, pin);
}

export function isValidPassword(value: string): boolean {
  return value.length >= 8;
}

export function isValidPin(value: string): boolean {
  return /^\d{4,6}$/.test(value);
}

export function isJsonMutation(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase());
}

export function getOriginHost(origin: string | undefined): string | undefined {
  if (!origin) {
    return undefined;
  }

  try {
    return new URL(origin).host;
  } catch {
    return undefined;
  }
}

export function isTrustedMutationSource(headers: IncomingHttpHeaders): boolean {
  const sourceHost = getOriginHost(headers.origin ?? headers.referer);
  const requestHost = headers['x-forwarded-host'] ?? headers.host;

  return Boolean(requestHost && sourceHost && sourceHost === requestHost);
}
