import { z } from 'zod';
import { useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { AuthUser, Family } from './auth.js';

export const OFFLINE_DATA_KEY = 'rodzina:offline-data:v1';
export const familyMembersKey = (familyId: string, userId: string) => ['family', familyId, userId, 'members'] as const;
const person = z.object({
  id: z.string().min(1),
  familyId: z.string().min(1),
  displayName: z.string(),
  color: z.string(),
  role: z.enum(['admin', 'member', 'child']),
});
const family = z.object({ id: z.string().min(1), name: z.string(), timezone: z.string(), joinCode: z.string() });
const schema = z
  .object({
    version: z.literal(1),
    account: z.string(),
    session: z.object({ user: person, family }),
    members: z.array(person).optional(),
    syncedAt: z.number().positive().optional(),
  })
  .refine(
    (data) =>
      data.account === accountId(data.session) &&
      data.session.user.familyId === data.session.family.id &&
      data.members?.every((member) => member.familyId === data.session.family.id) !== false,
  );
export type OfflineSession = { user: AuthUser; family: Family };
export const accountId = (session: { user: { id: string }; family: { id: string } }) =>
  `${session.family.id}:${session.user.id}`;
export type OfflineData = { session: OfflineSession; members?: AuthUser[] | undefined; syncedAt?: number | undefined };
const toUser = (value: z.infer<typeof person>): AuthUser => ({ ...value, email: null, createdAt: 0, updatedAt: 0 });
const minimalUser = (user: AuthUser) => person.parse(user);
let issue: string | undefined;
const listeners = new Set<() => void>();
function report(message?: string) {
  if (issue === message) return;
  issue = message;
  listeners.forEach((listener) => listener());
}
export function useOfflineStorageIssue() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => issue,
  );
}
export function readOfflineData(): OfflineData | undefined {
  try {
    const raw = localStorage.getItem(OFFLINE_DATA_KEY);
    if (!raw) return;
    const data = schema.parse(JSON.parse(raw));
    return {
      session: { user: toUser(data.session.user), family: data.session.family },
      members: data.members?.map(toUser),
      syncedAt: data.syncedAt,
    };
  } catch {
    report('Nie można odczytać danych rodziny na urządzeniu. Połącz się z internetem, aby pobrać je ponownie.');
  }
}
export function saveOfflineData(session: OfflineSession, members?: AuthUser[], syncedAt?: number) {
  try {
    const value = schema.parse({
      version: 1,
      account: accountId(session),
      session: { user: minimalUser(session.user), family: session.family },
      members: members?.map(minimalUser),
      syncedAt,
    });
    localStorage.setItem(OFFLINE_DATA_KEY, JSON.stringify(value));
    report();
    return true;
  } catch {
    report(
      'Nie można zapisać danych rodziny na urządzeniu. Zwolnij miejsce lub włącz pamięć przeglądarki. Dane mogą być niedostępne po zamknięciu aplikacji.',
    );
    return false;
  }
}
export function restoreOfflineData(client: QueryClient, data: OfflineData) {
  if (data.members)
    client.setQueryData(
      familyMembersKey(data.session.family.id, data.session.user.id),
      data.members,
      data.syncedAt === undefined ? undefined : { updatedAt: data.syncedAt },
    );
}
export function clearOfflineData() {
  try {
    localStorage.removeItem(OFFLINE_DATA_KEY);
    report();
  } catch {
    report('Nie można usunąć danych rodziny z pamięci urządzenia. Włącz dostęp do pamięci i wyloguj się ponownie.');
  }
}
