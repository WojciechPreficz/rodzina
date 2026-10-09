import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { AuthProvider, type AuthUser, type Family } from '../../auth.js';
import { FamilyPage } from './FamilyPage.js';

const family: Family = { id: 'f1', name: 'Kowalscy', timezone: 'Europe/Warsaw', joinCode: 'ABC123' };

const admin: AuthUser = {
  id: 'u-admin',
  familyId: 'f1',
  displayName: 'Anna',
  email: 'anna@example.com',
  role: 'admin',
  color: '#1C7ED6',
  createdAt: 1,
  updatedAt: 1,
};
const adult: AuthUser = { ...admin, id: 'u-member', displayName: 'Piotr', email: 'piotr@example.com', role: 'member' };
const child: AuthUser = { ...admin, id: 'u-child', displayName: 'Zosia', email: null, role: 'child' };

const INVITE_LINK = 'http://localhost:5173/zaproszenie/token-123';

function mockApi(me: AuthUser) {
  let members: AuthUser[] = [admin, adult, child];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    let status = 200;
    let body: unknown = { ok: true };

    if (url === '/api/auth/me') {
      body = { ok: true, user: me, family };
    } else if (url === '/api/members' && method === 'GET') {
      body = { ok: true, members };
    } else if (url === '/api/members/child' && method === 'POST') {
      const input = JSON.parse(String(init?.body)) as { displayName: string; color: string };
      const created: AuthUser = { ...child, id: 'u-child-2', displayName: input.displayName, color: input.color };
      members = [...members, created];
      status = 201;
      body = { ok: true, member: created };
    } else if (url === '/api/invitations' && method === 'POST') {
      body = { ok: true, link: INVITE_LINK, token: 'token-123' };
    }

    return { ok: status < 400, status, text: async () => JSON.stringify(body) } as Response;
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderFamilyPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

  return render(
    <QueryClientProvider client={queryClient}>
      <MantineProvider>
        <MemoryRouter initialEntries={['/wiecej/rodzina']}>
          <AuthProvider>
            <Routes>
              <Route path="/wiecej/rodzina" element={<FamilyPage />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
}

describe('FamilyPage', () => {
  beforeEach(() => {
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
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows every management action to an admin', async () => {
    mockApi(admin);
    renderFamilyPage();

    expect(await screen.findByText('Zosia')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dodaj dziecko' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Utwórz zaproszenie' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wygeneruj nowy kod' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Edytuj:/ })).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'Edytuj: Zosia' }));
    expect(await screen.findByLabelText('Nowy PIN')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usuń domownika' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Wygeneruj link resetu hasła' })).not.toBeInTheDocument();
  });

  it('lets a member edit only their own profile', async () => {
    mockApi(adult);
    renderFamilyPage();

    expect(await screen.findByText('Zosia')).toBeInTheDocument();
    expect(screen.getByText('ABC123')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dodaj dziecko' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Utwórz zaproszenie' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Wygeneruj nowy kod' })).not.toBeInTheDocument();

    const editButtons = screen.getAllByRole('button', { name: /^Edytuj:/ });
    expect(editButtons).toHaveLength(1);
    expect(editButtons[0]).toHaveAccessibleName('Edytuj: Piotr');
  });

  it('lets a child change only own name and color', async () => {
    mockApi(child);
    renderFamilyPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Edytuj: Zosia' }));
    expect(await screen.findByLabelText('Imię i nazwisko')).toHaveValue('Zosia');
    expect(screen.getByRole('radiogroup', { name: 'Kolor' })).toBeInTheDocument();
    expect(screen.queryByText('Rola')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Nowy PIN')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Usuń domownika' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Edytuj:/ })).toHaveLength(1);
  });

  it('creates an invitation link that can be copied', async () => {
    mockApi(admin);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderFamilyPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Utwórz zaproszenie' }));
    expect(await screen.findByDisplayValue(INVITE_LINK)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Kopiuj' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(INVITE_LINK));
    expect(await screen.findByRole('button', { name: 'Skopiowano' })).toBeInTheDocument();
  });

  it('refreshes the member list after adding a child', async () => {
    const fetchMock = mockApi(admin);
    renderFamilyPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Dodaj dziecko' }));
    fireEvent.change(await screen.findByLabelText(/Imię i nazwisko/), { target: { value: 'Kuba' } });
    fireEvent.change(screen.getByLabelText(/^PIN/), { target: { value: '1234' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Dodaj dziecko' }).at(-1)!);

    expect(await screen.findByText('Kuba')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/members/child', expect.objectContaining({ method: 'POST' }));
  });
});
