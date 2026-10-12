import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '@rodzina/shared';
import { MyReminders } from './MyReminders.js';
import { apiFetch } from '../../api.js';

vi.mock('../../api.js', () => ({ apiFetch: vi.fn() }));
vi.mock('../../auth.js', () => ({
  useMe: () => ({ user: { id: 'child', role: 'child' }, family: { id: 'family', timezone: 'Europe/Warsaw' } }),
}));
beforeEach(() => {
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
  vi.mocked(apiFetch).mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('lets a child add only their own reminder through the personal endpoint', async () => {
  vi.mocked(apiFetch).mockResolvedValue({ reminders: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MantineProvider>
        <MyReminders event={{ id: 'adult-event' } as CalendarEvent} />
      </MantineProvider>
    </QueryClientProvider>,
  );
  await screen.findByText('Brak przypomnień.');
  expect(screen.getByLabelText('Odbiorcy')).toHaveValue('Tylko ja');
  fireEvent.click(screen.getByRole('button', { name: 'Dodaj przypomnienie' }));
  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith('/api/reminders/mine', {
      method: 'POST',
      body: JSON.stringify({ eventId: 'adult-event', type: 'offset', offsetValue: 0, offsetUnit: 'minute' }),
    }),
  );
  expect(vi.mocked(apiFetch).mock.calls.every(([url]) => url.startsWith('/api/reminders/mine'))).toBe(true);
  client.clear();
});

it('shows a stale absolute reminder and deletes it through the personal endpoint', async () => {
  vi.mocked(apiFetch).mockResolvedValue({
    reminders: [{ id: 'mine', type: 'absolute', remindAt: 1, nextFireAt: null, audience: 'user' }],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MantineProvider>
        <MyReminders event={{ id: 'adult-event' } as CalendarEvent} />
      </MantineProvider>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('nieaktualne')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Usuń przypomnienie' }));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/api/reminders/mine/mine', { method: 'DELETE' }));
  client.clear();
});
