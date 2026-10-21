import { MantineProvider } from '@mantine/core';
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
const { request, clearSession } = vi.hoisted(() => ({ request: vi.fn(), clearSession: vi.fn(async () => {}) }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android' },
  registerPlugin: () => ({ request, clearSession }),
}));
vi.mock('../notifications/scheduleSync.js', () => ({ ScheduleSync: () => null }));
vi.mock('../notifications/localSchedule.js', () => ({
  localScheduler: { invalidate: vi.fn(), clear: vi.fn(async () => {}) },
}));
import type { AuthUser } from '@rodzina/shared';
import { AuthProvider, useMe } from '../../auth.js';
import { reportTransportFailure } from '../../connectivity.js';
import {
  clearOfflineData,
  familyMembersKey,
  OFFLINE_DATA_KEY,
  readOfflineData,
  saveOfflineData,
} from '../../offlineData.js';
import {
  enqueueShopping,
  readShoppingSession,
  restoreShopping,
  SHOPPING_STORAGE_KEY,
  stopShoppingPersistence,
} from '../shopping/shoppingOffline.js';
import { FamilyPage } from './FamilyPage.js';

const admin: AuthUser = {
  id: 'admin',
  familyId: 'family',
  displayName: 'Ania',
  email: 'ania@example.com',
  color: '#123456',
  role: 'admin',
  createdAt: 1,
  updatedAt: 1,
};
const child: AuthUser = { ...admin, id: 'child', role: 'child', displayName: 'Zosia', email: null };
const session = {
  user: admin,
  family: { id: 'family', name: 'Rodzina', timezone: 'Europe/Warsaw', joinCode: 'ABC123' },
};
const clients: QueryClient[] = [];
let serverSession = session;
let fail: number | 'transport' | undefined;
let failMembers = false;
const reply = (body: unknown, status = 200) => ({ status, body: JSON.stringify(body) });
function Harness() {
  const auth = useMe();
  return (
    <>
      <button onClick={() => void auth.refresh()}>refresh</button>
      <button onClick={() => void auth.logout()}>logout</button>
      <button
        onClick={() => {
          serverSession = { ...session, user: child };
          auth.setSession(child, session.family);
        }}
      >
        switch
      </button>
      {auth.user ? <FamilyPage /> : <span>{auth.isLoading ? 'loading' : 'logged out'}</span>}
    </>
  );
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const view = render(
    <QueryClientProvider client={client}>
      <MantineProvider>
        <MemoryRouter>
          <AuthProvider>
            <Harness />
          </AuthProvider>
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
  return { ...view, client };
}
async function synced() {
  await waitFor(() => expect(readOfflineData()?.members).toHaveLength(2));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Dodaj dziecko' })).toBeEnabled());
}
beforeEach(() => {
  localStorage.clear();
  clearOfflineData();
  reportTransportFailure(false);
  onlineManager.setOnline(true);
  focusManager.setFocused(true);
  serverSession = session;
  fail = undefined;
  failMembers = false;
  request.mockImplementation(async ({ path }: { path: string }) => {
    if (fail && (!failMembers || path === '/api/members')) {
      if (fail === 'transport') throw new Error('Network unavailable');
      return reply({ error: { message: 'Błąd serwera' } }, fail);
    }
    return reply(path === '/api/auth/me' ? serverSession : path === '/api/members' ? { members: [admin, child] } : {});
  });
  vi.stubGlobal(
    'matchMedia',
    vi.fn((media: string) => ({
      matches: false,
      media,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) {
    stopShoppingPersistence(client);
    client.clear();
  }
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  clearOfflineData();
  reportTransportFailure(false);
  onlineManager.setOnline(true);
  focusManager.setFocused(undefined);
});

describe('family offline lifecycle through the Android transport', () => {
  it('restores members and the code on cold start and blocks all visible admin actions', async () => {
    saveOfflineData(session, [admin, child], 123);
    onlineManager.setOnline(false);
    mount();
    expect(await screen.findByText('Zosia')).toBeVisible();
    expect(screen.getByText('ABC123')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Jesteś offline');
    expect(screen.getByRole('status')).toHaveTextContent('Ostatnie udane pobranie');
    for (const name of ['Dodaj dziecko', 'Utwórz zaproszenie', 'Wygeneruj nowy kod', 'Edytuj: Ania', 'Edytuj: Zosia'])
      expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(request).not.toHaveBeenCalled();
  });

  it('shows the no-cache message and does not treat a legacy empty code as valid', async () => {
    const previous = new QueryClient();
    restoreShopping(previous, session);
    previous.setQueryData(['shopping', 'family', 'admin', 'lists'], []);
    await new Promise((resolve) => setTimeout(resolve, 10));
    stopShoppingPersistence(previous);
    previous.clear();
    onlineManager.setOnline(false);
    mount();
    expect(await screen.findByText(/Brak danych rodziny zapisanych/)).toBeVisible();
    expect(screen.getByText('Brak zapisanego kodu rodziny')).toBeVisible();
    expect(screen.getByRole('status')).toBeVisible();
    expect(screen.queryByText('ABC123')).not.toBeInTheDocument();
  });

  it('migrates a legacy account without dropping pending shopping operations', async () => {
    onlineManager.setOnline(false);
    const previous = new QueryClient();
    restoreShopping(previous, session);
    previous.setQueryData(['shopping', 'family', 'admin', 'lists'], []);
    void enqueueShopping(
      previous,
      { familyId: 'family', userId: 'admin' },
      { type: 'createList', id: 'pending', name: 'Sklep' },
    ).catch(() => {});
    stopShoppingPersistence(previous);
    previous.clear();
    const journal = Object.keys(localStorage).find((key) => key.includes(':operation:'))!;
    const savedOperation = localStorage.getItem(journal);
    const view = mount();
    await screen.findByText(/Brak danych rodziny zapisanych/);
    expect(view.client.getMutationCache().getAll()).toHaveLength(1);
    // Keep the write in flight while refreshing the independent read snapshot.
    const queued = view.client.getMutationCache().getAll()[0]!;
    queued.setOptions({ ...queued.options, mutationFn: () => new Promise(() => {}) });
    act(() => onlineManager.setOnline(true));
    fireEvent.click(screen.getByText('refresh'));
    await synced();
    expect(localStorage.getItem(journal)).toBe(savedOperation);
    expect(readShoppingSession()?.user.id).toBe('admin');
  });

  it.each(['add', 'edit-child', 'edit-adult'])(
    'blocks an already open %s form when the network disappears',
    async (form) => {
      mount();
      await synced();
      fireEvent.click(
        screen.getByRole('button', {
          name: form === 'add' ? 'Dodaj dziecko' : form === 'edit-child' ? 'Edytuj: Zosia' : 'Edytuj: Ania',
        }),
      );
      const dialog = screen.getByRole('dialog');
      act(() => onlineManager.setOnline(false));
      const before = request.mock.calls.length;
      expect(within(dialog).getByText('Dostępne po połączeniu z internetem')).toBeVisible();
      for (const button of within(dialog).getAllByRole('button')) {
        if (
          ['Zapisz', 'Dodaj dziecko', 'Usuń domownika', 'Wygeneruj link resetu hasła'].includes(
            button.textContent ?? '',
          )
        )
          expect(button).toBeDisabled();
      }
      fireEvent.submit(dialog.querySelector('form')!);
      expect(request).toHaveBeenCalledTimes(before);
    },
  );

  it('detects unreachable API despite online status and refreshes the code on reconnect', async () => {
    mount();
    await synced();
    fail = 'transport';
    fireEvent.click(screen.getByText('refresh'));
    expect(await screen.findByRole('status')).toHaveTextContent('Jesteś offline');
    expect(onlineManager.isOnline()).toBe(true);
    expect(screen.getByText('ABC123')).toBeVisible();
    fail = undefined;
    serverSession = { ...session, family: { ...session.family, joinCode: 'NEW123' } };
    act(() => {
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.getByText('NEW123')).toBeVisible();
    expect(readOfflineData()?.session.family.joinCode).toBe('NEW123');
  });

  it.each([401, 403])('removes memory and disk on confirmed HTTP %s', async (status) => {
    const { client } = mount();
    await synced();
    fail = status;
    failMembers = true;
    fireEvent.click(screen.getByText('refresh'));
    await screen.findByText('logged out');
    expect(localStorage.getItem(OFFLINE_DATA_KEY)).toBeNull();
    expect(localStorage.getItem(SHOPPING_STORAGE_KEY)).toBeNull();
    expect(client.getQueryData(familyMembersKey('family', 'admin'))).toBeUndefined();
  });

  it('preserves cached data and displays an HTTP server error without calling it offline', async () => {
    mount();
    await synced();
    const saved = localStorage.getItem(OFFLINE_DATA_KEY);
    fail = 500;
    fireEvent.click(screen.getByText('refresh'));
    expect(await screen.findByText('Błąd serwera')).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('ABC123')).toBeVisible();
    expect(localStorage.getItem(OFFLINE_DATA_KEY)).toBe(saved);
  });

  it('clears data on offline logout', async () => {
    const { client } = mount();
    await synced();
    act(() => onlineManager.setOnline(false));
    fail = 'transport';
    fireEvent.click(screen.getByText('logout'));
    await screen.findByText('logged out');
    expect(localStorage.getItem(OFFLINE_DATA_KEY)).toBeNull();
    expect(client.getQueryData(familyMembersKey('family', 'admin'))).toBeUndefined();
    await waitFor(() => expect(clearSession).toHaveBeenCalled());
  });

  it('hides administrator actions for a child restored offline', async () => {
    saveOfflineData({ ...session, user: child }, [admin, child], 123);
    onlineManager.setOnline(false);
    mount();
    expect(await screen.findByText('ABC123')).toBeVisible();
    for (const name of ['Dodaj dziecko', 'Utwórz zaproszenie', 'Wygeneruj nowy kod', 'Edytuj: Ania']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Edytuj: Zosia' })).toBeDisabled();
  });

  it('retains the saved view while refreshing after resuming the app', async () => {
    mount();
    await synced();
    let finish!: (value: ReturnType<typeof reply>) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(finish).toBeDefined());
    expect(screen.getByText('ABC123')).toBeVisible();
    expect(screen.getByText('Zosia')).toBeVisible();
    await act(async () => {
      finish(reply({ ...session, family: { ...session.family, joinCode: 'RESUME' } }));
    });
    expect(await screen.findByText('RESUME')).toBeVisible();
    expect(readOfflineData()?.session.family.joinCode).toBe('RESUME');
  });

  it('does not let a delayed rejection of the previous account remove the new account', async () => {
    mount();
    await synced();
    let finish!: (value: ReturnType<typeof reply>) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(screen.getByText('refresh'));
    await waitFor(() => expect(finish).toBeDefined());
    fireEvent.click(screen.getByText('switch'));
    await waitFor(() => expect(readOfflineData()?.session.user.id).toBe('child'));
    await act(async () => {
      finish(reply({}, 401));
    });
    expect(screen.queryByText('logged out')).not.toBeInTheDocument();
    expect(readOfflineData()?.session.user.id).toBe('child');
  });

  it.each(['corrupt', 'unavailable'])('reports %s storage when no account can be restored', async (failure) => {
    if (failure === 'corrupt') localStorage.setItem(OFFLINE_DATA_KEY, '{broken');
    else
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('Disabled');
      });
    fail = 'transport';
    mount();
    expect(await screen.findByText('logged out')).toBeVisible();
    expect(screen.getByText(/Nie można odczytać danych rodziny/)).toBeVisible();
  });

  it('isolates a changed account and ignores its predecessor’s delayed member response', async () => {
    const { client } = mount();
    await synced();
    let finish!: (value: ReturnType<typeof reply>) => void;
    request
      .mockImplementationOnce(async () => reply(session))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    fireEvent.click(screen.getByText('refresh'));
    await waitFor(() => expect(finish).toBeDefined());
    fireEvent.click(screen.getByText('switch'));
    await waitFor(() => expect(readOfflineData()?.session.user.id).toBe('child'));
    await act(async () => {
      finish(reply({ members: [{ ...admin, displayName: 'Stale person' }] }));
    });
    expect(screen.queryByText('Stale person')).not.toBeInTheDocument();
    expect(client.getQueryData(familyMembersKey('family', 'admin'))).toBeUndefined();
    expect(screen.queryByRole('button', { name: 'Dodaj dziecko' })).not.toBeInTheDocument();
    expect(readOfflineData()?.session.user.id).toBe('child');
  });

  it('reports a failed durable save while retaining the online view', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    mount();
    expect(await screen.findByText(/Nie można zapisać danych rodziny/)).toBeVisible();
    expect(screen.getByText('Zosia')).toBeVisible();
    expect(localStorage.getItem(OFFLINE_DATA_KEY)).toBeNull();
  });
});
