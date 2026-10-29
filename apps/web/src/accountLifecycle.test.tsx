import { act, cleanup, renderHook } from '@testing-library/react';
import { focusManager, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AuthUser, Family } from '@rodzina/shared';
import { useAccountLifecycle, type AccountServices } from './accountLifecycle.js';
import { SYNC_INTERVAL_MS } from './queryClient.js';
import { ACCOUNT_SIGNAL_KEY } from './offline/database.js';

vi.mock('./accountStorage.js', () => ({
  clearAccountData: vi.fn(async () => {}),
  restoreAccountStores: vi.fn(async () => {}),
  stopAccountPersistence: vi.fn(),
}));
vi.mock('./offline/database.js', () => ({
  ACCOUNT_SIGNAL_KEY: 'account-signal',
  activateOfflineAccount: vi.fn(async () => {}),
  announceAccount: vi.fn(),
  recoverPendingClear: vi.fn(async () => {}),
  hasPendingClear: () => false,
}));

const session = {
  user: { id: 'adult', familyId: 'family', displayName: 'Anna' } as AuthUser,
  family: { id: 'family' } as Family,
};
const services: AccountServices = {
  accountId: ({ user, family }) => `${family.id}:${user.id}`,
  familyMembersKey: () => ['members'],
  hydrateOfflineData: async () => undefined,
  restoreOfflineData: vi.fn(),
  saveOfflineData: async () => true,
  listMembers: async () => [],
  readFallbackSession: async () => undefined,
  pendingLogoutKey: 'pending-logout',
  invalidateAlarms: vi.fn(),
  migrationCompleted: vi.fn(),
  foreignStorage: () => false,
};
const unauthorized = () => new Response('{}', { status: 401 });
const authorized = () => new Response(JSON.stringify(session));

beforeEach(() => {
  vi.useFakeTimers();
  onlineManager.setOnline(true);
  focusManager.setFocused(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

async function backgroundRefresh() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SYNC_INTERVAL_MS * 2);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
}

it('stops anonymous session polling after 401 and resumes after login', async () => {
  const request = vi.fn().mockImplementation(unauthorized);
  vi.stubGlobal('fetch', request);
  const { result } = renderHook(() => useAccountLifecycle(services));
  await act(async () => {});
  expect(result.current.value.isLoading).toBe(false);
  expect(request).toHaveBeenCalledTimes(1);
  await backgroundRefresh();
  expect(request).toHaveBeenCalledTimes(1);

  request.mockImplementation(authorized);
  await act(async () => result.current.value.setSession(session.user, session.family));
  expect(result.current.value.user?.id).toBe('adult');
  request.mockClear();
  await backgroundRefresh();
  expect(request).toHaveBeenCalled();
});

it('retries after transport failure when session status is still unknown', async () => {
  const request = vi.fn().mockRejectedValue(new TypeError('Offline'));
  vi.stubGlobal('fetch', request);
  renderHook(() => useAccountLifecycle(services));
  await act(async () => {});
  request.mockImplementation(authorized);
  await backgroundRefresh();
  expect(request.mock.calls.length).toBeGreaterThan(1);
});

it('checks again after another tab changes the account', async () => {
  const request = vi.fn().mockImplementation(unauthorized);
  vi.stubGlobal('fetch', request);
  const { result } = renderHook(() => useAccountLifecycle(services));
  await act(async () => {});
  request.mockImplementation(authorized);
  await act(async () => {
    window.dispatchEvent(new StorageEvent('storage', { key: ACCOUNT_SIGNAL_KEY }));
  });
  await backgroundRefresh();
  expect(result.current.value.user?.id).toBe('adult');
});
