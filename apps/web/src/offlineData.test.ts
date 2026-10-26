import './offline/testSetup.js';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearOfflineData,
  familyMembersKey,
  OFFLINE_DATA_KEY,
  readOfflineData,
  hydrateOfflineData,
  restoreOfflineData,
  saveOfflineData,
} from './offlineData.js';
import type { AuthUser } from '@rodzina/shared';

const user: AuthUser = {
  id: 'user',
  familyId: 'family',
  displayName: 'Ania',
  color: '#123456',
  role: 'admin',
  email: 'private@example.com',
  createdAt: 1,
  updatedAt: 2,
};
const session = { user, family: { id: 'family', name: 'Rodzina', timezone: 'Europe/Warsaw', joinCode: 'ABC123' } };
afterEach(async () => {
  vi.restoreAllMocks();
  localStorage.clear();
  await clearOfflineData();
});

describe('shared offline data', () => {
  it('persists an allowlist, including the join code, and restores account-scoped members', async () => {
    const sensitive = {
      ...user,
      pin: '9876',
      password: 'secret',
      token: 'session-token',
      invitation: '/zaproszenie/private',
    };
    expect(await saveOfflineData({ ...session, user: sensitive }, [sensitive], 123)).toBe(true);
    const { readCache } = await import('./offline/database.js');
    const raw = JSON.stringify((await readCache('family'))?.payload);
    for (const secret of [
      'private@example.com',
      '9876',
      'secret',
      'session-token',
      '/zaproszenie/private',
      'email',
      'createdAt',
    ])
      expect(raw).not.toContain(secret);
    const restored = readOfflineData()!;
    expect(restored.session.family.joinCode).toBe('ABC123');
    expect(restored.syncedAt).toBe(123);
    const client = new QueryClient();
    restoreOfflineData(client, restored);
    expect(client.getQueryData<AuthUser[]>(familyMembersKey('family', 'user'))?.[0]?.displayName).toBe('Ania');
    expect(client.getQueryData(familyMembersKey('family', 'other'))).toBeUndefined();
    client.clear();
  });

  it.each(['{bad json', '{"version":2}', JSON.stringify({ version: 1, account: 'other', session })])(
    'rejects corrupt or incompatible records: %s',
    async (raw) => {
      localStorage.setItem(OFFLINE_DATA_KEY, raw);
      expect(await hydrateOfflineData()).toBeUndefined();
    },
  );

  it('does not claim success or overwrite the last valid snapshot when storage is full', async () => {
    await saveOfflineData(session, [user], 123);
    const { IDBObjectStore } = await import('fake-indexeddb');
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    expect(await saveOfflineData({ ...session, family: { ...session.family, joinCode: 'NEW123' } }, [user], 456)).toBe(
      false,
    );
    expect(readOfflineData()?.session.family.joinCode).toBe('ABC123');
  });
});
