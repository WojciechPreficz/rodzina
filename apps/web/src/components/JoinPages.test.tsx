import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { AuthProvider } from '../auth.js';
import { ChildLoginPage, InvitationPage, ResetPasswordPage } from './JoinPages.js';

const session = { user: { id: 'c1', displayName: 'Zosia', role: 'child' }, family: { id: 'f1', name: 'Kowalscy' } };
function response(payload: object, status = 200) {
  return { ok: status < 400, status, text: async () => JSON.stringify(payload) } as Response;
}
function renderPage(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MantineProvider>
        <MemoryRouter initialEntries={[path]}>
          <AuthProvider>
            <Routes>
              <Route path="/login-child" element={<ChildLoginPage />} />
              <Route path="/zaproszenie/:token" element={<InvitationPage />} />
              <Route path="/reset-hasla/:token" element={<ResetPasswordPage />} />
              <Route path="/zakupy" element={<div>Child destination</div>} />
              <Route path="/" element={<div>Family destination</div>} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
  return client;
}

describe('joining and child authentication', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((media: string) => ({
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('selects a child, uses the PIN keyboard and returns to next after a failed attempt', async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('/api/auth/family-members'))
        return response({ members: [{ id: 'c1', displayName: 'Zosia', color: '#7BC6B9' }] });
      if (url === '/api/auth/login-child')
        return ++attempts === 1 ? response({ error: { message: 'Błędny PIN.' } }, 401) : response(session);
      return response({ error: { message: 'Brak sesji.' } }, 401);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage('/login-child?next=%2Fzakupy');
    fireEvent.change(screen.getByRole('textbox', { name: /Kod rodziny/ }), { target: { value: 'abc234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pokaż profile' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Zosia' }));
    for (const digit of '1234') fireEvent.click(screen.getByRole('button', { name: `Cyfra ${digit}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Zaloguj się' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Błędny PIN.');
    expect(screen.getByLabelText('PIN')).toHaveValue('');
    for (const digit of '12345') fireEvent.click(screen.getByRole('button', { name: `Cyfra ${digit}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Usuń ostatnią cyfrę' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zaloguj się' }));
    expect(await screen.findByText('Child destination')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/login-child',
      expect.objectContaining({ body: JSON.stringify({ joinCode: 'ABC234', userId: 'c1', pin: '1234' }) }),
    );
  });

  it('shows the API error for an invalid family code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response({ error: { message: 'Nie znaleziono rodziny.' } }, 404)),
    );
    renderPage('/login-child');
    fireEvent.change(screen.getByRole('textbox', { name: /Kod rodziny/ }), { target: { value: 'ABC234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pokaż profile' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nie znaleziono rodziny.');
  });

  it.each(['Zaproszenie wygasło.', 'Zaproszenie zostało już wykorzystane.'])(
    'shows an unusable invitation: %s',
    async (message) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response({ error: { message } }, 410)),
      );
      renderPage('/zaproszenie/invalid');
      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(screen.queryByRole('button', { name: 'Dołącz do rodziny' })).not.toBeInTheDocument();
    },
  );

  it('validates and accepts the invitation with the token from the route', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/accept')) return response(session);
      if (url.startsWith('/api/invitations/')) return response({ family: { name: 'Kowalscy' } });
      return response({ error: { message: 'Brak sesji.' } }, 401);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage('/zaproszenie/invite-token');
    const submit = await screen.findByRole('button', { name: 'Dołącz do rodziny' });
    fireEvent.click(submit);
    expect(screen.getByText('Imię musi mieć co najmniej 2 znaki.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: /Imię i nazwisko/ }), { target: { value: 'Piotr' } });
    fireEvent.change(screen.getByRole('textbox', { name: /E-mail/ }), { target: { value: 'piotr@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Hasło/), { target: { value: 'password123' } });
    fireEvent.click(submit);
    expect(await screen.findByText('Family destination')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/invitations/invite-token/accept',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ displayName: 'Piotr', email: 'piotr@example.com', password: 'password123' }),
      }),
    );
  });

  it('checks password confirmation and reports reset errors and success', async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/reset-password')
        return ++attempts === 1 ? response({ error: { message: 'Token wygasł.' } }, 410) : response({ ok: true });
      return response({ error: { message: 'Brak sesji.' } }, 401);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPage('/reset-hasla/reset-token');
    fireEvent.change(screen.getByLabelText(/^Nowe hasło/), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText(/^Powtórz hasło/), { target: { value: 'different123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Hasła muszą być takie same.');
    fireEvent.change(screen.getByLabelText(/^Powtórz hasło/), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Token wygasł.'));
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Hasło zostało zmienione');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/reset-password',
      expect.objectContaining({ body: JSON.stringify({ token: 'reset-token', password: 'password123' }) }),
    );
  });
});
