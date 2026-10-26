import { z } from 'zod';
import { registerAdapter } from './offline/registry.js';
import {
  activateOfflineAccount,
  accountToken,
  clearDatabase,
  ensureMigrated,
  isAccountCurrent,
  readCache,
  writeCache,
} from './offline/database.js';
import { reportStorageIssue, storageError } from './offline/status.js';
export { useOfflineStorageIssue } from './offline/status.js';
import type { QueryClient } from '@tanstack/react-query';
import type { AuthUser, Family } from '@rodzina/shared';

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
export const offlineDataSchema = z
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
registerAdapter({
  module: 'family',
  schemaVersion: 1,
  capabilities: 'read-only',
  legacyKey: OFFLINE_DATA_KEY,
  budget: 2 * 1048576,
  parseCache: (value) => offlineDataSchema.parse(value),
  trim: (value) => value,
  describe: (value) => {
    const data = offlineDataSchema.parse(value);
    return { syncedAt: data.syncedAt ?? null, coverage: data.members === undefined ? 'partial' : 'complete' };
  },
});
let savedData: OfflineData | undefined;
export function readOfflineData(): OfflineData | undefined {
  return savedData;
}
export async function hydrateOfflineData(): Promise<OfflineData | undefined> {
  const token = accountToken();
  try {
    await ensureMigrated();
    if (!isAccountCurrent(token)) return;
    const record = await readCache('family');
    if (!isAccountCurrent(token)) return;
    if (!record) return;
    if (record.schemaVersion !== 1) throw new Error('Nieobsługiwana wersja danych rodziny. Zaktualizuj aplikację.');
    const data = offlineDataSchema.parse(record.payload);
    await activateOfflineAccount(data.account);
    if (!isAccountCurrent(token)) return;
    savedData = {
      session: { user: toUser(data.session.user), family: data.session.family },
      members: data.members?.map(toUser),
      syncedAt: data.syncedAt,
    };
    return savedData;
  } catch (error) {
    if (isAccountCurrent(token)) reportStorageIssue(`Nie można odczytać danych rodziny. ${storageError(error)}`);
  }
}
export async function saveOfflineData(session: OfflineSession, members?: AuthUser[], syncedAt?: number) {
  const token = accountToken();
  try {
    await ensureMigrated();
    if (!isAccountCurrent(token)) return false;
    await activateOfflineAccount(accountId(session));
    if (!isAccountCurrent(token)) return false;
    const value = offlineDataSchema.parse({
      version: 1,
      account: accountId(session),
      session: { user: minimalUser(session.user), family: session.family },
      members: members?.map(minimalUser),
      syncedAt,
    });
    await writeCache('family', value, token);
    if (!isAccountCurrent(token)) return false;
    savedData = {
      session: { user: toUser(value.session.user), family: value.session.family },
      members: value.members?.map(toUser),
      syncedAt: value.syncedAt,
    };
    reportStorageIssue();
    return true;
  } catch (error) {
    if (isAccountCurrent(token))
      reportStorageIssue(`Nie można zapisać danych rodziny na urządzeniu. ${storageError(error)}`);
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
export function forgetOfflineData() {
  savedData = undefined;
}
export async function clearOfflineData() {
  forgetOfflineData();
  try {
    await clearDatabase();
  } catch (error) {
    reportStorageIssue(`Nie można usunąć danych rodziny. ${storageError(error)}`);
    throw error;
  }
}
