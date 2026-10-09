import crypto from 'node:crypto';
import { hash as hashArgon2, verify as verifyArgon2 } from '@node-rs/argon2';

export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 60;

export function hashToken(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function generateJoinCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

export async function hashPassword(value: string): Promise<string> {
  return hashArgon2(value, { parallelism: 1, memoryCost: 65536, timeCost: 3 });
}

export async function hashPin(value: string): Promise<string> {
  return hashArgon2(value, { parallelism: 1, memoryCost: 65536, timeCost: 3 });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return verifyArgon2(hash, password);
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
