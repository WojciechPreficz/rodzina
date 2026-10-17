import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { request, clearSession } = vi.hoisted(() => ({ request: vi.fn(), clearSession: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android' },
  registerPlugin: () => ({ request, clearSession }),
}));
import { AuthProvider, useMe, type AuthUser, type Family } from './auth.js';
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
  vi.clearAllMocks();
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
  it('clears credentials and cached data when logging out offline', async () => {
    request.mockResolvedValueOnce({ status: 200, body: JSON.stringify(session) });
    const client = mount();
    await screen.findByText('Anna');
    client.setQueryData(['events'], ['private cached data']);
    request.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByText('logout'));
    await screen.findByText('logged out');
    expect(clearSession).toHaveBeenCalledOnce();
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
