import { StrictMode } from 'react';
import './offline/testSetup.js';
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
import { AppSession as AuthProvider } from './AppSession.js';
import { useMe } from './sessionContext.js';
import { localScheduler } from './features/notifications/localSchedule.js';
import { ACCOUNT_SIGNAL_KEY, clearDatabase } from './offline/database.js';
import { readShoppingData } from './features/shopping/shoppingStorage.js';
import { CONTACTS_STORAGE_KEY, contactsStore } from './features/contacts/contactsOffline.js';
import { restoreShopping, stopShoppingPersistence, SHOPPING_STORAGE_KEY } from './features/shopping/shoppingOffline.js';
vi.mock('./features/notifications/localSchedule.js', () => ({
  localScheduler: { clear: vi.fn(async () => undefined), invalidate: vi.fn() },
}));
vi.mock('./features/notifications/scheduleSync.js', () => ({ ScheduleSync: () => null }));

const session = {
  user: { id: 'adult', familyId: 'family', displayName: 'Anna' } as AuthUser,
  family: { id: 'family' } as Family,
};
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
afterEach(async () => {
  cleanup();
  await contactsStore.clear();
  vi.clearAllMocks();
  localStorage.clear();
});
function mount() {
  const client = new QueryClient();
  render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AuthProvider>
            <Harness />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
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
    await clearDatabase();
    const other = new QueryClient();
    await restoreShopping(other, { ...session, user: { ...session.user, id: 'other' } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    stopShoppingPersistence(other);
    other.clear();
    window.dispatchEvent(new StorageEvent('storage', { key: ACCOUNT_SIGNAL_KEY, newValue: 'changed' }));
    await screen.findByText('logged out');
    expect((await readShoppingData())?.session.user.id).toBe('other');
  });

  it('restores the shopping account after a cold offline start', async () => {
    const previous = new QueryClient();
    await restoreShopping(previous, session);
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
    await restoreShopping(previous, session);
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
    await waitFor(() => expect(clearSession).toHaveBeenCalledOnce());
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
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    fireEvent.click(screen.getByText('switch'));
    await screen.findByText('Zosia');
    finish({ status: 200, body: JSON.stringify(session) });
    await waitFor(() => expect(client.getQueryData(['events'])).toBeUndefined());
    expect(screen.queryByText('Anna')).toBeNull();
  });
});

it('cleans session polling and listeners after Strict Mode, account changes and remounting', async () => {
  const set = vi.spyOn(window, 'setInterval');
  const clear = vi.spyOn(window, 'clearInterval');
  const add = vi.spyOn(window, 'addEventListener');
  const remove = vi.spyOn(window, 'removeEventListener');
  const intervals = () =>
    set.mock.results.filter(
      (result, i) =>
        result.type === 'return' &&
        set.mock.calls[i]?.[1] === 20000 &&
        !clear.mock.calls.some(([id]) => id === result.value),
    );
  const listeners = () =>
    add.mock.calls.filter(([name]) => name === 'rodzina:session-lost').length -
    remove.mock.calls.filter(([name]) => name === 'rodzina:session-lost').length;
  try {
    request.mockResolvedValueOnce({ status: 200, body: JSON.stringify(session) });
    const client = mount();
    await screen.findByText('Anna');
    await waitFor(() => {
      expect(intervals()).toHaveLength(2);
      expect(listeners()).toBe(2);
    });
    fireEvent.click(screen.getByText('switch'));
    await screen.findByText('Zosia');
    await waitFor(() => {
      expect(intervals()).toHaveLength(2);
      expect(listeners()).toBe(2);
    });
    cleanup();
    client.clear();
    expect(intervals()).toHaveLength(0);
    expect(listeners()).toBe(0);
    request.mockRejectedValueOnce(new Error('offline'));
    const remounted = mount();
    await screen.findByText('Zosia');
    await waitFor(() => {
      expect(intervals()).toHaveLength(2);
      expect(listeners()).toBe(2);
    });
    cleanup();
    remounted.clear();
    expect(intervals()).toHaveLength(0);
    expect(listeners()).toBe(0);
  } finally {
    cleanup();
    set.mockRestore();
    clear.mockRestore();
    add.mockRestore();
    remove.mockRestore();
  }
});
