import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { sanitizeNextPath } from '../api.js';
import { LoginPage, RegisterPage } from './AuthPages.js';
import { AppShell } from './AppShell.js';
import { AuthProvider } from '../auth.js';

describe('AppShell', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows all four primary navigation destinations', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    render(
      <MantineProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<span>Kalendarz</span>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );

    const navigation = screen.getByRole('navigation', { name: 'Nawigacja główna' });
    expect(navigation).toHaveTextContent('Kalendarz');
    expect(navigation).toHaveTextContent('Zakupy');
    expect(navigation).toHaveTextContent('Obiady');
    expect(navigation).toHaveTextContent('Więcej');
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
    fireEvent.change(screen.getByLabelText('Imię i nazwisko'), { target: { value: 'Anna' } });
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
