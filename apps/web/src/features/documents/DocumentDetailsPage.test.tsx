import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { FamilyDocument } from '@rodzina/shared';
import { DocumentDetailsPage } from './DocumentDetailsPage.js';
import { useDocumentAttentionCount } from './documentQueries.js';

const session = vi.hoisted(() => ({
  user: { id: 'user', role: 'admin' },
  family: { id: 'family', timezone: 'Europe/Warsaw' },
  familyConfirmed: true,
}));
const connection = vi.hoisted(() => ({ offline: false }));
const refresh = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../sessionContext.js', () => ({ useMe: () => session }));
vi.mock('../../connectivity.js', () => ({ useOffline: () => connection.offline, isOffline: () => connection.offline }));
vi.mock('../family/familyQueries.js', () => ({ useMembersQuery: () => ({ data: [] }) }));
vi.mock('../notifications/scheduleSync.js', () => ({ refreshLocalSchedule: refresh }));
const document: FamilyDocument = {
  id: 'doc',
  familyId: 'family',
  createdBy: 'user',
  createdAt: 1,
  updatedAt: 1,
  type: 'other',
  label: 'Polisa',
  expiresOn: '2026-10-20',
  holderUserId: null,
  vehicleLabel: null,
  notes: null,
  status: 'expired',
  reminders: [],
};
let client: QueryClient;
function Attention() {
  return <span data-testid="attention">{useDocumentAttentionCount()}</span>;
}
function setup({ missing = false, failure = false } = {}) {
  let current = { ...document };
  let reminders: unknown[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (failure && method !== 'GET')
      return new Response(JSON.stringify({ error: { message: 'Błąd zapisu' } }), { status: 400 });
    if (url.endsWith('/renew')) current = { ...current, ...JSON.parse(String(init?.body)) };
    if (url === '/api/reminders/mine' && method === 'POST')
      reminders = [
        {
          ...JSON.parse(String(init?.body)),
          id: 'mine',
          audience: 'user',
          nextFireAt: 1900000000000,
        },
      ];
    if (method === 'DELETE') reminders = [];
    return new Response(
      JSON.stringify(url.startsWith('/api/reminders/mine') ? { reminders } : { documents: missing ? [] : [current] }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MantineProvider env="test">
        <MemoryRouter initialEntries={['/dokumenty/doc']}>
          <Attention />
          <Routes>
            <Route path="/dokumenty/:documentId" element={<DocumentDetailsPage />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}
beforeEach(() => {
  session.user.role = 'admin';
  connection.offline = false;
  session.familyConfirmed = true;
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-25T10:00:00Z'));
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup();
  client?.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  refresh.mockClear();
});

it('opens the selected document, renews it and updates the attention count and schedule', async () => {
  const mock = setup();
  await screen.findByRole('heading', { name: 'Polisa' });
  expect(screen.getByTestId('attention')).toHaveTextContent('1');
  fireEvent.click(screen.getByRole('button', { name: 'Odnowiono' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Nowa data ważności', { exact: false }), {
    target: { value: '2030-10-25' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz nową datę' }));
  await screen.findByText(/ważny do 25.10.2030/);
  expect(screen.getByTestId('attention')).toHaveTextContent('0');
  expect(mock).toHaveBeenCalledWith(
    '/api/documents/doc/renew',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ expiresOn: '2030-10-25' }) }),
  );
  expect(refresh).toHaveBeenCalled();
});

it('keeps renewal errors visible without changing the attention count', async () => {
  setup({ failure: true });
  fireEvent.click(await screen.findByRole('button', { name: 'Odnowiono' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Nowa data ważności', { exact: false }), {
    target: { value: '2030-10-25' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz nową datę' }));
  await within(dialog).findByText('Błąd zapisu');
  expect(screen.getByTestId('attention')).toHaveTextContent('1');
});

it('allows a child to manage only personal reminders without renewing the document', async () => {
  session.user.role = 'child';
  const mock = setup();
  await screen.findByRole('heading', { name: 'Polisa' });
  expect(screen.queryByRole('button', { name: 'Odnowiono' })).not.toBeInTheDocument();
  const section = screen.getByRole('region', { name: 'Moje przypomnienia' });
  const add = within(section).getByRole('button', { name: 'Dodaj przypomnienie' });
  await waitFor(() => expect(add).toBeEnabled());
  fireEvent.click(add);
  await within(section).findByRole('button', { name: 'Usuń przypomnienie' });
  expect(mock).toHaveBeenCalledWith(
    '/api/reminders/mine',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ documentId: 'doc', type: 'offset', offsetValue: 1, offsetUnit: 'day' }),
    }),
  );
  fireEvent.click(within(section).getByRole('button', { name: 'Usuń przypomnienie' }));
  await waitFor(() =>
    expect(within(section).queryByRole('button', { name: 'Usuń przypomnienie' })).not.toBeInTheDocument(),
  );
  expect(mock).toHaveBeenCalledWith('/api/reminders/mine/mine', expect.objectContaining({ method: 'DELETE' }));
  expect(mock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  expect(refresh).toHaveBeenCalledTimes(2);
});

it('handles a removed or foreign document without showing another document', async () => {
  setup({ missing: true });
  await screen.findByText(/Nie znaleziono dokumentu/);
  expect(screen.queryByRole('region', { name: 'Moje przypomnienia' })).not.toBeInTheDocument();
});

it('does not fetch documents while offline and explains the connection requirement', () => {
  connection.offline = true;
  const mock = setup();
  expect(screen.getByText(/Brak połączenia/)).toBeInTheDocument();
  expect(mock).not.toHaveBeenCalled();
});
