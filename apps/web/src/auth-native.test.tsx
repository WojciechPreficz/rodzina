import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { request, clearSession } = vi.hoisted(() => ({ request: vi.fn(), clearSession: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android' },
  registerPlugin: () => ({ request, clearSession }),
}));
import type { AuthUser, Family } from '@rodzina/shared';
import { AuthProvider, useMe } from './auth.js';
import { localScheduler } from './features/notifications/localSchedule.js';
import { CONTACTS_STORAGE_KEY, contactsStore } from './features/contacts/contactsOffline.js';
import { restoreShopping, stopShoppingPersistence, SHOPPING_STORAGE_KEY } from './features/shopping/shoppingOffline.js';
vi.mock('./features/notifications/localSchedule.js', () => ({
  localScheduler: { clear: vi.fn(async () => undefined), invalidate: vi.fn() },
}));
vi.mock('./features/notifications/scheduleSync.js', () => ({ ScheduleSync: () => null }));

const session = { user: { id: 'adult', displayName: 'Anna' } as AuthUser, family: { id: 'family' } as Family };
function Harness() {
  const auth = useMe();
  return (
    <>
      <span>{auth.isLoading ? 'loading' : (auth.user?.displayName ?? 'logged out')}</span>
      <button
        onClick={() => {
          void auth.logout();
        }}
      >
        logout
      </button>
      <button onClick={() => auth.setSession({ ...session.user, id: 'child', displayName: 'Zosia' }, session.family)}>
        switch
      </button>
    </>
  );
}
afterEach(() => {
  cleanup();
  contactsStore.clear();
  vi.clearAllMocks();
  localStorage.clear();
});
function mount() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuthProvider>
          <Harness />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

describe('native session lifecycle', () => {
  it('invalidates contacts on a foreign tab account without deleting its snapshot', async () => {
    request.mockResolvedValueOnce({ status: 200, body: JSON.stringify(session) });
    mount();
    await screen.findByText('Anna');
    const saved = JSON.stringify({ account: 'family:other', version: 1 });
    localStorage.setItem(CONTACTS_STORAGE_KEY, saved);
    window.dispatchEvent(new StorageEvent('storage', { key: CONTACTS_STORAGE_KEY, newValue: saved }));
    await screen.findByText('logged out');
    expect(contactsStore.snapshot().account).toBe('');
    expect(localStorage.getItem(CONTACTS_STORAGE_KEY)).toBe(saved);
  });
  it('drops its own session after an account change in another tab without deleting that new account', async () => {
    request.mockResolvedValueOnce({ status: 200, body: JSON.stringify(session) });
    mount();
    await screen.findByText('Anna');
    const other = new QueryClient();
    restoreShopping(other, { ...session, user: { ...session.user, id: 'other' } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    stopShoppingPersistence(other);
    other.clear();
    window.dispatchEvent(
      new StorageEvent('storage', { key: SHOPPING_STORAGE_KEY, newValue: localStorage.getItem(SHOPPING_STORAGE_KEY) }),
    );
    await screen.findByText('logged out');
    expect(JSON.parse(localStorage.getItem(SHOPPING_STORAGE_KEY)!).session.user.id).toBe('other');
  });

  it('restores the shopping account after a cold offline start', async () => {
    const previous = new QueryClient();
    restoreShopping(previous, session);
    previous.setQueryData(['shopping', 'family', 'adult', 'lists'], []);
    await new Promise((resolve) => setTimeout(resolve, 10));
    stopShoppingPersistence(previous);
    previous.clear();
    request.mockRejectedValueOnce(new Error('offline'));
    mount();
    await screen.findByText('Anna');
  });

  it('discards offline data when the server rejects an expired session', async () => {
    const previous = new QueryClient();
    restoreShopping(previous, session);
    await new Promise((resolve) => setTimeout(resolve, 10));
    stopShoppingPersistence(previous);
    previous.clear();
    request.mockResolvedValueOnce({ status: 401, body: '{}' });
    mount();
    await screen.findByText('logged out');
    expect(localStorage.getItem(SHOPPING_STORAGE_KEY)).toBeNull();
  });
  it('clears credentials and cached data when logging out offline', async () => {
    request.mockResolvedValueOnce({ status: 200, body: JSON.stringify(session) });
    const client = mount();
    await screen.findByText('Anna');
    client.setQueryData(['events'], ['private cached data']);
    request.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByText('logout'));
    await screen.findByText('logged out');
    expect(clearSession).toHaveBeenCalledOnce();
    expect(localScheduler.clear).toHaveBeenCalled();
    expect(client.getQueryData(['events'])).toBeUndefined();
  });

  it('discards a stale initial session response and clears cache before changing accounts', async () => {
    let finish!: (value: { status: number; body: string }) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const client = mount();
    client.setQueryData(['events'], ['old account']);
    fireEvent.click(screen.getByText('switch'));
    await screen.findByText('Zosia');
    finish({ status: 200, body: JSON.stringify(session) });
    await waitFor(() => expect(client.getQueryData(['events'])).toBeUndefined());
    expect(screen.queryByText('Anna')).toBeNull();
  });
});
