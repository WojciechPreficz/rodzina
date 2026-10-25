import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
const f = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock('./localSchedule.js', () => ({ alarmStore: { preview: f.preview } }));
vi.mock('../../auth.js', () => ({ useMe: () => ({ refresh: vi.fn() }) }));
vi.mock('../../platform.js', () => ({ isAndroid: () => true }));
import { OfflineReminder } from './OfflineReminder.js';
const url = '/kalendarz/wydarzenie/10000000-0000-4000-8000-000000000002?data=2026-10-20';
function show(path = url) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider env="test">
        <MemoryRouter initialEntries={[path]}>
          <OfflineReminder />
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('shows only the saved occurrence, with a warning and no editing', async () => {
  const item = {
    key: 'one',
    reminderId: '10000000-0000-4000-8000-000000000001',
    sourceType: 'event',
    sourceId: '10000000-0000-4000-8000-000000000002',
    occurrenceDate: '2026-10-20',
    fireAt: 1,
    title: 'Basen',
    body: '20.10.2026, 17:00',
    url,
  };
  f.preview.mockResolvedValue({
    value: JSON.stringify({
      snapshot: {
        ok: true,
        generatedAt: 0,
        validUntil: 100,
        reminders: [item, { ...item, key: 'other', url: url.replace('20', '21'), title: 'Inny termin' }],
      },
    }),
  });
  show();
  expect(await screen.findByText('Basen')).toBeVisible();
  expect(screen.getByText('20.10.2026, 17:00')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('może być nieaktualny');
  expect(screen.queryByText('Inny termin')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Edytuj' })).toBeNull();
});
it('does not show payload data without a stored native session or after logout', async () => {
  f.preview.mockResolvedValue({ value: null });
  show();
  expect(await screen.findByRole('status')).toHaveTextContent('Brak zapisanego przypomnienia');
  expect(screen.getByRole('link', { name: 'Przejdź do logowania' }).getAttribute('href')).toContain('next=');
});

it('shows only the document named by the alarm with its saved absolute expiry date', async () => {
  const path = '/dokumenty/10000000-0000-4000-8000-000000000002';
  const item = {
    key: 'doc',
    reminderId: '10000000-0000-4000-8000-000000000001',
    sourceType: 'document',
    sourceId: '10000000-0000-4000-8000-000000000002',
    occurrenceDate: '2026-11-15',
    fireAt: 1,
    title: 'Dokument',
    body: 'OC Skoda — ważne do 15.11.2026',
    url: path,
  };
  f.preview.mockResolvedValue({
    value: JSON.stringify({
      snapshot: {
        ok: true,
        generatedAt: 0,
        validUntil: 100,
        reminders: [item, { ...item, key: 'another', url: path.replace(/2$/, '3'), body: 'Inny dokument' }],
      },
    }),
  });
  show(path);
  expect(await screen.findByText('OC Skoda — ważne do 15.11.2026')).toBeVisible();
  expect(screen.queryByText('Inny dokument')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Odnowiono' })).not.toBeInTheDocument();
});
