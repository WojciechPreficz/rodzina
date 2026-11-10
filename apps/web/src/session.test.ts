import { recoverLegacyData } from './offline/legacyRecovery.js';
import './offline/testSetup.js';
import { readFileSync } from 'node:fs';
import { IDBObjectStore } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { readAccountSession, saveAccountSession, type AccountSession } from './session.js';
import {
  activateOfflineAccount,
  clearDatabase,
  closeDatabase,
  invalidateOfflineContext,
  requestValue,
  transact,
  CLEAR_PENDING_KEY,
} from './offline/database.js';

const session = {
  user: { id: 'user', familyId: 'family', role: 'admin', email: 'private@example.test' },
  family: { id: 'family', joinCode: 'secret' },
} as AccountSession;
const sanitized = { user: { ...session.user, email: null }, family: { ...session.family } };
afterEach(() => vi.restoreAllMocks());

async function legacy(module: 'shopping' | 'family', value = session) {
  await activateOfflineAccount('family:user');
  await transact('readwrite', async (tx) => {
    tx.objectStore('cache').put({
      accountId: 'family:user',
      module,
      key: 'snapshot',
      schemaVersion: 1,
      payload: { account: 'family:user', version: 1, session: value, operations: 'corrupt' },
    });
  });
}

it('returns no session for an empty database', async () => {
  expect(await readAccountSession()).toBeUndefined();
});

it('persists the confirmed session across restart without module data or email', async () => {
  expect(await saveAccountSession(session)).toBe(true);
  await closeDatabase();
  expect(await readAccountSession()).toEqual(sanitized);
  expect(await transact('readonly', async (tx) => requestValue(tx.objectStore('cache').count()))).toBe(0);
});

it.each(['shopping', 'family'] as const)('migrates %s only once and leaves its format intact', async (module) => {
  await legacy(module);
  expect(await readAccountSession()).toEqual(sanitized);
  const before = await transact('readonly', async (tx) => requestValue(tx.objectStore('cache').getAll()));
  expect(before[0].payload.version).toBe(1);
  await transact('readwrite', async (tx) => {
    tx.objectStore('cache').clear();
  });
  await closeDatabase();
  expect(await readAccountSession()).toEqual(sanitized);
});

it('imports the unchanged legacy fixture through the existing migration protocol', async () => {
  const fixture = JSON.parse(readFileSync('test-fixtures/offline/legacy-valid.json', 'utf8'));
  for (const entry of fixture.entries) localStorage.setItem(entry.key, JSON.stringify(entry.value));
  await recoverLegacyData();
  const expected = fixture.entries.find((entry: { key: string }) => entry.key === 'rodzina:offline-data:v1').value
    .session;
  expect((await readAccountSession())?.user.id).toBe(expected.user.id);
  await closeDatabase();
  expect((await readAccountSession())?.family.id).toBe(expected.family.id);
});

it('keeps the legacy source and retries migration when the metadata write fails', async () => {
  await legacy('shopping');
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, ...args) {
    if (this.name === 'metadata' && value.key === 'account-session:1')
      throw new DOMException('Full', 'QuotaExceededError');
    return put.call(this, value, ...args);
  });
  expect(await readAccountSession()).toBeUndefined();
  expect(await transact('readonly', async (tx) => requestValue(tx.objectStore('cache').count()))).toBe(1);
  vi.restoreAllMocks();
  expect(await readAccountSession()).toEqual(sanitized);
});

it('rejects a foreign legacy session', async () => {
  await legacy('shopping', { ...session, user: { ...session.user, id: 'other' } });
  expect(await readAccountSession()).toBeUndefined();
});

it('clears the session and rejects stale writes when the account changes', async () => {
  await saveAccountSession(session);
  const delayed = saveAccountSession(session);
  await clearDatabase();
  expect(await delayed).toBe(false);
  expect(await readAccountSession()).toBeUndefined();
  const other = { ...session, user: { ...session.user, id: 'other' } };
  expect(await saveAccountSession(other)).toBe(true);
  expect(await saveAccountSession(session)).toBe(false);
  expect((await readAccountSession())?.user.id).toBe('other');
});

it('does not restore a session across an invalidation or pending cleanup', async () => {
  await saveAccountSession(session);
  const delayed = readAccountSession();
  invalidateOfflineContext();
  expect(await delayed).toBeUndefined();
  localStorage.setItem(CLEAR_PENDING_KEY, 'yes');
  expect(await readAccountSession()).toBeUndefined();
  expect(await saveAccountSession(session)).toBe(false);
});
