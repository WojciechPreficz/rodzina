import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { DOCUMENT_TYPES, type FamilyDocument } from '@rodzina/shared';
import { DocumentsPage } from './DocumentsPage.js';
import { documentExpiry, documentTypeLabels, hasHolder, hasVehicle } from './documentUi.js';
import { theme, cssVariablesResolver } from '../../theme.js';
import { DocumentForm } from './DocumentForm.js';

const session = vi.hoisted(() => ({
  user: { id: '10000000-0000-4000-8000-000000000001', role: 'admin' },
  family: { id: 'family', timezone: 'Europe/Warsaw' },
  familyConfirmed: true,
}));
vi.mock('../../auth.js', () => ({ useMe: () => session }));
vi.mock('../family/familyQueries.js', () => ({
  useMembersQuery: () => ({ data: [{ id: session.user.id, displayName: 'Anna' }] }),
}));
vi.mock('../../connectivity.js', () => ({ useOffline: () => false, isOffline: () => false }));
const base: FamilyDocument = {
  id: 'document',
  familyId: 'family',
  createdBy: session.user.id,
  createdAt: 1,
  updatedAt: 1,
  type: 'passport',
  label: 'Paszport Anny',
  holderUserId: session.user.id,
  vehicleLabel: null,
  expiresOn: '2028-05-12',
  notes: null,
  status: 'valid',
  reminders: [],
};
let client: QueryClient;
function setup(items = [base], fail = false) {
  let documents = [...items];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (fail && method !== 'GET')
      return new Response(JSON.stringify({ error: { message: 'Błąd zapisu' } }), { status: 400 });
    if (method === 'POST') documents.push({ ...base, ...JSON.parse(String(init?.body)), id: 'new' });
    if (method === 'PATCH') documents = documents.map((item) => ({ ...item, ...JSON.parse(String(init?.body)) }));
    if (method === 'DELETE') documents = [];
    return new Response(JSON.stringify({ documents, document: documents.at(-1), deleted: true }));
  });
  vi.stubGlobal('fetch', fetchMock);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MantineProvider env="test" theme={theme} cssVariablesResolver={cssVariablesResolver}>
        <DocumentsPage />
      </MantineProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}
beforeEach(() => {
  session.user.role = 'admin';
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-24T10:00:00Z'));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup();
  client?.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function add() {
  await screen.findByText('Paszport Anny');
  fireEvent.click(screen.getAllByRole('button', { name: '＋ Dodaj dokument' })[0]!);
  return screen.findByRole('dialog');
}
describe('document list and form', () => {
  it('opens the form with the real theme and active textarea autosize in development', () => {
    render(
      <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver}>
        <DocumentForm members={[]} timezone="Europe/Warsaw" pending={false} onSave={vi.fn()} onCancel={vi.fn()} />
      </MantineProvider>,
    );
    const notes = screen.getByRole('textbox', { name: /Notatka/ });
    fireEvent.change(notes, { target: { value: 'Pierwszy wiersz\nDrugi wiersz\nTrzeci wiersz' } });
    expect(notes).toHaveValue('Pierwszy wiersz\nDrugi wiersz\nTrzeci wiersz');
    expect(screen.getByRole('button', { name: 'Zapisz' })).toBeEnabled();
  });
  it.each(DOCUMENT_TYPES)('adapts and saves fields and default reminders for %s', async (type) => {
    const fetchMock = setup();
    const dialog = await add();
    if (type !== 'id_card') {
      fireEvent.click(within(dialog).getByRole('textbox', { name: 'Typ dokumentu' }));
      fireEvent.click(screen.getByRole('option', { name: documentTypeLabels[type] }));
    }
    expect(within(dialog).queryByRole('textbox', { name: 'Posiadacz' }) !== null).toBe(hasHolder(type));
    expect(within(dialog).queryByRole('textbox', { name: 'Pojazd' }) !== null).toBe(hasVehicle(type));
    expect(within(dialog).getByText('Nie wpisuj numerów dokumentów')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Nazwa dokumentu' }), {
      target: { value: 'Nowy dokument' },
    });
    fireEvent.change(within(dialog).getByLabelText('Data ważności', { exact: false }), {
      target: { value: '2029-05-12' },
    });
    if (hasVehicle(type))
      fireEvent.change(within(dialog).getByRole('textbox', { name: 'Pojazd' }), { target: { value: 'Skoda' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    await screen.findByText('Nowy dokument');
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({
      type,
      holderUserId: null,
      vehicleLabel: hasVehicle(type) ? 'Skoda' : null,
      reminders:
        type === 'other'
          ? [{ type: 'offset', offsetValue: 30, offsetUnit: 'day', audience: 'adults' }]
          : expect.any(Array),
    });
  });
  it('shows all statuses with corresponding colors and filters by holder and vehicles', async () => {
    setup([
      base,
      {
        ...base,
        id: 'car',
        label: 'OC Skoda',
        type: 'car_insurance',
        holderUserId: null,
        vehicleLabel: 'Skoda',
        expiresOn: '2026-11-10',
      },
      { ...base, id: 'expired', label: 'Stary dowód', expiresOn: '2026-10-23' },
    ]);
    await screen.findByText('Paszport Anny');
    for (const [name, status] of [
      ['Paszport Anny', 'valid'],
      ['OC Skoda', 'expiring'],
      ['Stary dowód', 'expired'],
    ])
      expect(screen.getByText(name!).closest('li')).toHaveAttribute('data-status', status);
    fireEvent.click(screen.getByRole('button', { name: 'Pojazdy' }));
    expect(screen.getByText('OC Skoda')).toBeInTheDocument();
    expect(screen.queryByText('Paszport Anny')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Anna' }));
    expect(screen.getByText('Paszport Anny')).toBeInTheDocument();
    expect(screen.queryByText('OC Skoda')).not.toBeInTheDocument();
  });
  it('hides all write actions for a child', async () => {
    session.user.role = 'child';
    setup();
    await screen.findByText('Paszport Anny');
    expect(screen.queryByRole('button', { name: /Dodaj dokument|Edytuj|Usuń/ })).not.toBeInTheDocument();
  });
  it('preserves existing reminders on a label edit and confirms deletion', async () => {
    const mock = setup();
    await screen.findByText('Paszport Anny');
    fireEvent.click(screen.getByRole('button', { name: 'Edytuj Paszport Anny' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Nazwa dokumentu' }), {
      target: { value: 'Paszport' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    await screen.findByText('Paszport');
    expect(
      JSON.parse(String(mock.mock.calls.find(([, init]) => init?.method === 'PATCH')![1]?.body)),
    ).not.toHaveProperty('reminders');
    fireEvent.click(screen.getByRole('button', { name: 'Usuń Paszport' }));
    const confirmation = await screen.findByRole('dialog');
    expect(mock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Usuń dokument' }));
    await screen.findByText('Nie dodano jeszcze dokumentów.');
  });
  it('allows removing all default reminders and displays failed saves without closing the form', async () => {
    const mock = setup([base], true);
    const dialog = await add();
    while (within(dialog).queryAllByRole('button', { name: 'Usuń przypomnienie' }).length)
      fireEvent.click(within(dialog).getAllByRole('button', { name: 'Usuń przypomnienie' })[0]!);
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Nazwa dokumentu' }), { target: { value: 'Nowy' } });
    fireEvent.change(within(dialog).getByLabelText('Data ważności', { exact: false }), {
      target: { value: '2029-05-12' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => expect(within(dialog).getByText('Błąd zapisu')).toBeInTheDocument());
    expect(JSON.parse(String(mock.mock.calls.find(([, init]) => init?.method === 'POST')![1]?.body)).reminders).toEqual(
      [],
    );
  });
});
describe('expiry descriptions', () => {
  it('uses calendar months, handles expiry day and expired dates', () => {
    expect(documentExpiry('2028-05-12', '2026-10-24')).toBe('ważny do 12.05.2028 (za 1 rok i 6 mies.)');
    expect(documentExpiry('2026-10-24', '2026-10-24')).toContain('wygasa dzisiaj');
    expect(documentExpiry('2026-10-23', '2026-10-24')).toContain('wygasł 1 dzień temu');
    expect(documentExpiry('2026-10-25', '2026-10-24')).toContain('wygasa jutro');
  });
});
