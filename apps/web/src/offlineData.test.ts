import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearOfflineData,
  familyMembersKey,
  OFFLINE_DATA_KEY,
  readOfflineData,
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
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  clearOfflineData();
});

describe('shared offline data', () => {
  it('persists an allowlist, including the join code, and restores account-scoped members', () => {
    const sensitive = {
      ...user,
      pin: '9876',
      password: 'secret',
      token: 'session-token',
      invitation: '/zaproszenie/private',
    };
    expect(saveOfflineData({ ...session, user: sensitive }, [sensitive], 123)).toBe(true);
    const raw = localStorage.getItem(OFFLINE_DATA_KEY)!;
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
    (raw) => {
      localStorage.setItem(OFFLINE_DATA_KEY, raw);
      expect(readOfflineData()).toBeUndefined();
    },
  );

  it('does not claim success or overwrite the last valid snapshot when storage is full', () => {
    saveOfflineData(session, [user], 123);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    expect(saveOfflineData({ ...session, family: { ...session.family, joinCode: 'NEW123' } }, [user], 456)).toBe(false);
    expect(readOfflineData()?.session.family.joinCode).toBe('ABC123');
  });
});
