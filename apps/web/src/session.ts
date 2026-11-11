import type { AuthUser, Family } from '@rodzina/shared';
import { z } from 'zod';
import {
  accountToken,
  activateOfflineAccount,
  assertContext,
  hasPendingClear,
  isAccountCurrent,
  offlineOwner,
  requestValue,
  SESSION_KEY,
  transact,
  type Active,
} from './offline/database.js';
import { reportStorageIssue, storageError } from './offline/status.js';

export type AccountSession = { user: AuthUser; family: Family };
export const PENDING_LOGOUT_KEY = 'rodzina:pending-logout';
const id = z.string().min(1);
const sessionSchema = z
  .object({
    user: z.object({ id, familyId: id }).passthrough(),
    family: z.object({ id }).passthrough(),
  })
  .refine((session) => session.user.familyId === session.family.id);
type Record = { value: AccountSession };
type Legacy = { accountId: string; schemaVersion: number; payload: { account: string; session?: unknown } };
const identity = (session: AccountSession) => `${session.family.id}:${session.user.id}`;
function parseSession(value: unknown, account: string): AccountSession {
  const session = sessionSchema.parse(value) as AccountSession;
  if (identity(session) !== account) throw new Error('Zapisana sesja należy do innego konta.');
  return session;
}
const minimalSession = (session: AccountSession): AccountSession => ({
  user: { ...session.user, email: null },
  family: { ...session.family },
});

export async function readSavedAccountSession(tx: IDBTransaction, account: string) {
  const record = await requestValue<Record | undefined>(tx.objectStore('metadata').get([account, SESSION_KEY]));
  return record && parseSession(record.value, account);
}

async function readStored(token: number, migrate: boolean) {
  if (!(await offlineOwner(token))) return;
  const active = await transact(
    'readonly',
    async (tx) => requestValue<Active | undefined>(tx.objectStore('metadata').get(['__origin__', 'active'])),
    token,
  );
  if (!active) return;
  const accountId = active.value.accountId;
  if (!isAccountCurrent(token)) throw new DOMException('Session changed', 'AbortError');
  await activateOfflineAccount(accountId);
  return transact(
    migrate ? 'readwrite' : 'readonly',
    async (tx) => {
      assertContext(tx, accountId);
      const saved = await readSavedAccountSession(tx, accountId);
      if (saved || !migrate) return saved;
      // Only the legacy session envelope is needed; module data and outboxes are independent.
      for (const module of ['family', 'shopping']) {
        const legacy = await requestValue<Legacy | undefined>(
          tx.objectStore('cache').get([accountId, module, 'snapshot']),
        );
        if (!legacy) continue;
        const parsed = sessionSchema.safeParse(legacy.payload?.session);
        if (!parsed.success) continue;
        if (legacy.schemaVersion !== 1 || legacy.accountId !== accountId || legacy.payload.account !== accountId)
          throw new Error('Zapisana sesja należy do innego konta.');
        const value = minimalSession(parseSession(parsed.data, accountId));
        tx.objectStore('metadata').put({ accountId, key: SESSION_KEY, value });
        return value;
      }
    },
    token,
  );
}

export async function readAccountSession(): Promise<AccountSession | undefined> {
  const token = accountToken();
  try {
    if (hasPendingClear()) throw new Error('Pamięć konta jest niedostępna lub jej czyszczenie nie zostało zakończone.');
    const saved = await readStored(token, false);
    if (!isAccountCurrent(token)) return;
    if (saved) return saved;
    return await readStored(token, true);
  } catch (error) {
    if (isAccountCurrent(token)) reportStorageIssue(`Nie można odczytać sesji offline. ${storageError(error)}`);
  }
}

export async function saveAccountSession(session: AccountSession): Promise<boolean> {
  const token = accountToken();
  try {
    if (hasPendingClear()) return false;
    const account = identity(session);
    const value = minimalSession(parseSession(session, account));
    await activateOfflineAccount(account);
    if (!isAccountCurrent(token)) return false;
    await transact(
      'readwrite',
      async (tx) => {
        assertContext(tx, account);
        tx.objectStore('metadata').put({ accountId: account, key: SESSION_KEY, value });
      },
      token,
    );
    return true;
  } catch (error) {
    if (isAccountCurrent(token)) reportStorageIssue(`Nie można zapisać sesji offline. ${storageError(error)}`);
    return false;
  }
}
