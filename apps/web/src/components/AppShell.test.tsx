import '../offline/testSetup.js';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { sanitizeNextPath } from '../api.js';
import { LoginPage, RegisterPage } from './AuthPages.js';
import { AppShell } from './AppShell.js';
import { AuthProvider } from '../auth.js';
import { addNavigationGuard } from '../nativeNavigation.js';
import { theme, cssVariablesResolver } from '../theme.js';

function mockViewport(desktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: desktop && query === '(min-width: 48em)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function renderShell(path = '/') {
  return render(
    <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} forceColorScheme="light">
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="*" element={<span>Page content</span>} />
            </Route>
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe('AppShell', () => {
  beforeEach(() => {
    mockViewport(true);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ user: { displayName: 'Anna', role: 'admin' }, family: { name: 'Test' } }),
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows direct destinations and selects the calendar at the root URL', async () => {
    renderShell();
    const navigation = screen.getByRole('navigation', { name: 'Nawigacja główna' });
    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'Kalendarz',
      'Zadania',
      'Zakupy',
      'Obiady',
      'Rodzina',
      'Kontakty',
      'Dokumenty',
      'Powiadomienia',
      'Wersja aplikacji',
    ]);
    expect(within(navigation).getByRole('link', { name: 'Kalendarz' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByText('Anna')).toBeInTheDocument();
    expect(screen.getByText('Administrator')).toBeInTheDocument();
    expect(screen.queryByText(/Test/)).not.toBeInTheDocument();
    expect(document.querySelector('.mantine-AppShell-header')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Otwórz menu' })).not.toBeInTheDocument();
  });

  it.each([
    '/kalendarz/wydarzenie/event-1',
    '/zadania',
    '/kontakty',
    '/dokumenty',
    '/zakupy',
    '/obiady',
    '/wiecej',
    '/wiecej/rodzina',
    '/wiecej/powiadomienia',
  ])('marks only the matching section active at %s', async (path) => {
    renderShell(path);
    const links = screen
      .getByRole('navigation', { name: 'Nawigacja główna' })
      .querySelectorAll('[aria-current="page"]');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', path.startsWith('/kalendarz') ? '/kalendarz' : path);
    await screen.findByText('Anna');
  });

  it('opens mobile navigation and closes it after selecting a destination or pressing Escape', async () => {
    mockViewport(false);
    renderShell();
    expect(screen.queryByRole('navigation', { name: 'Nawigacja główna' })).not.toBeInTheDocument();
    const burger = screen.getByRole('button', { name: 'Otwórz menu' });
    fireEvent.click(burger);
    const dialog = await screen.findByRole('dialog', { name: 'Menu Rodziny' });
    expect(burger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(within(dialog).getByRole('link', { name: 'Rodzina' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(burger);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Rodzina' })).toHaveAttribute('aria-current', 'page');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', bubbles: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('protects dirty forms before logging out and calls logout after approval', async () => {
    renderShell();
    await screen.findByText('Anna');
    const remove = addNavigationGuard(() => false);
    fireEvent.click(screen.getByRole('button', { name: 'Wyloguj się' }));
    expect(fetch).not.toHaveBeenCalledWith('/api/auth/logout', expect.anything());
    remove();
    fireEvent.click(screen.getByRole('button', { name: 'Wyloguj się' }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' })),
    );
  });

  it('rejects invalid next values and validates login and registration forms', async () => {
    expect(sanitizeNextPath('/zakupy')).toBe('/zakupy');
    expect(sanitizeNextPath('https://evil.example/path')).toBe('/');
    expect(sanitizeNextPath('//evil.example')).toBe('/');

    render(
      <MantineProvider>
        <MemoryRouter initialEntries={['/login?next=%2Fzakupy']}>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/zakupy" element={<div>Zakupy</div>} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </MantineProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Zaloguj się' }));
    await waitFor(() => expect(screen.getByText('E-mail jest wymagany.')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'anna@example.com' } });
    fireEvent.change(screen.getByLabelText('Hasło'), { target: { value: '12345678' } });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, user: { displayName: 'Anna' }, family: { name: 'Test' } }),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Zaloguj się' }));
    await waitFor(() => expect(screen.getByText('Zakupy')).toBeInTheDocument());

    cleanup();
    render(
      <MantineProvider>
        <MemoryRouter initialEntries={['/register']}>
          <AuthProvider>
            <Routes>
              <Route path="/register" element={<RegisterPage />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </MantineProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Utwórz rodzinę' }));
    await waitFor(() => expect(screen.getByText('Nazwa rodziny musi mieć co najmniej 2 znaki.')).toBeInTheDocument());
  });

  it('sends registration fields to the API and returns to the requested page', async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: url !== '/api/auth/me',
      text: async () =>
        JSON.stringify(
          url === '/api/auth/me'
            ? { error: { message: 'Brak sesji.' } }
            : { user: { id: 'u1', displayName: 'Anna' }, family: { id: 'f1', name: 'Kowalscy' } },
        ),
    }));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MantineProvider>
        <MemoryRouter initialEntries={['/register?next=%2Fzakupy']}>
          <AuthProvider>
            <Routes>
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/zakupy" element={<div>Registered destination</div>} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </MantineProvider>,
    );
    fireEvent.change(screen.getByLabelText('Nazwa rodziny'), { target: { value: 'Kowalscy' } });
    fireEvent.change(screen.getByLabelText('Twoje imię'), { target: { value: 'Anna' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'anna@example.com' } });
    fireEvent.change(screen.getByLabelText('Hasło'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Utwórz rodzinę' }));
    expect(await screen.findByText('Registered destination')).toBeInTheDocument();
    const registration = fetchMock.mock.calls.find(([url]) => url === '/api/auth/register-family');
    expect(registration).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/register-family',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          familyName: 'Kowalscy',
          displayName: 'Anna',
          email: 'anna@example.com',
          password: 'password123',
        }),
      }),
    );
  });
});
