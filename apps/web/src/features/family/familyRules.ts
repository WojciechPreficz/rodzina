import type { AuthUser } from '../../auth.js';
import { labels } from '../../i18n/pl.js';

type Actor = Pick<AuthUser, 'id' | 'role'>;

export function isFamilyAdmin(actor: Actor): boolean {
  return actor.role === 'admin';
}

export function canEditProfile(actor: Actor, target: Pick<AuthUser, 'id'>): boolean {
  return actor.role === 'admin' || actor.id === target.id;
}

export function validateDisplayName(value: string): string {
  return value.trim().length >= 2 ? '' : labels.displayNameError;
}

export function validatePin(value: string): string {
  return /^\d{4,6}$/.test(value) ? '' : labels.pinError;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
