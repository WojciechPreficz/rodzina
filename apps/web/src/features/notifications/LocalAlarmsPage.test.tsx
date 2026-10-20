import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocalAlarmsPage } from './LocalAlarmsPage.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({
  permissions: vi.fn(),
  sync: vi.fn(),
  retry: vi.fn(),
  request: vi.fn(),
  exact: vi.fn(),
  status: vi.fn(),
  settings: vi.fn(),
}));
vi.mock('../../platform.js', () => ({ isAndroid: () => true }));
vi.mock('../../auth.js', () => ({ useMe: () => ({ user: { id: 'user', familyId: 'family' } }) }));
vi.mock('./localSchedule.js', () => ({ localScheduler: mocks, alarmStore: { openAppSettings: mocks.settings } }));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { requestPermissions: mocks.request, changeExactNotificationSetting: mocks.exact },
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  mocks.permissions.mockResolvedValue({ display: 'denied', exact: 'denied' });
  mocks.sync.mockRejectedValue(new Error('Brak zgody'));
  mocks.status.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function show() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider>
        <LocalAlarmsPage />
      </MantineProvider>
    </QueryClientProvider>,
  );
}

it.each(['Synchronizuj teraz', 'Sprawdź zgody po powrocie z ustawień'])(
  'refreshes only once when clicking %s',
  async (name) => {
    mocks.sync.mockResolvedValue(undefined);
    show();
    await screen.findByText('Powiadomienia: brak zgody');
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledOnce());
    mocks.sync.mockClear();
    mocks.sync.mockRejectedValue(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name }));
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    await waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled());
    expect(mocks.sync).toHaveBeenCalledOnce();
  },
);

it('checks permissions without prompting and asks only on explicit clicks', async () => {
  show();
  await screen.findByText('Powiadomienia: brak zgody');
  expect(mocks.request).not.toHaveBeenCalled();
  await waitFor(() => expect(mocks.sync).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Zezwól na powiadomienia' }));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Zezwól na dokładne alarmy' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Zezwól na dokładne alarmy' }));
  await waitFor(() => expect(mocks.exact).toHaveBeenCalledOnce());
});
it('shows actual counts and an incomplete result after partial failure', async () => {
  mocks.sync.mockResolvedValue({
    count: 1,
    total: 2,
    complete: false,
    generatedAt: Date.now(),
    validUntil: Date.now() + 60000,
  });
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Synchronizuj teraz' }));
  expect(await screen.findByRole('status')).toHaveTextContent('nie jest w pełni zabezpieczony');
  expect(screen.getByRole('status')).toHaveTextContent('1 z 2');
  expect(mocks.sync).toHaveBeenCalledWith('family:user');
});
it('shows network or permission errors without a success message', async () => {
  mocks.sync.mockRejectedValue(new Error('Brak zgody'));
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Synchronizuj teraz' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Brak zgody');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('keeps the previous successful timestamp visible after a failed synchronization without claiming success', async () => {
  mocks.sync.mockRejectedValue(new Error('offline'));
  mocks.status.mockResolvedValue({
    count: 1,
    total: 1,
    complete: true,
    generatedAt: Date.UTC(2026, 9, 17, 8),
    validUntil: Date.UTC(2026, 10, 17, 8),
    lastSuccessfulAt: Date.UTC(2026, 9, 17, 8),
  });
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent('offline');
  expect(screen.getByRole('status')).toHaveTextContent('Ostatnia udana synchronizacja: 17.10.2026, 10:00');
  expect(screen.getByRole('status')).not.toHaveTextContent('Harmonogram zapisany.');
});

it('confirms granted permissions on disabled buttons and shows the next saved alarm', async () => {
  mocks.permissions.mockResolvedValue({
    display: 'granted',
    exact: 'granted',
    backgroundRestricted: false,
    manufacturer: 'OPPO',
  });
  mocks.sync.mockResolvedValue({
    count: 1,
    total: 1,
    complete: true,
    issues: [],
    generatedAt: Date.UTC(2026, 9, 19, 10),
    validUntil: Date.UTC(2026, 9, 20, 10),
    nextFireAt: Date.UTC(2026, 9, 19, 11),
  });
  show();
  expect(await screen.findByRole('button', { name: 'Powiadomienia dozwolone' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Dokładne alarmy dozwolone' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Najbliższy zapisany alarm: 19.10.2026, 13:00');
  expect(screen.getByText(/Na telefonach OPPO/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ustawienia pracy w tle' }));
  await waitFor(() => expect(mocks.settings).toHaveBeenCalledOnce());
});

it('explains a background restriction even when all expected alarms are saved', async () => {
  mocks.permissions.mockResolvedValue({
    display: 'granted',
    exact: 'granted',
    backgroundRestricted: true,
    manufacturer: 'OPPO',
  });
  mocks.sync.mockResolvedValue({
    count: 1,
    total: 1,
    complete: false,
    issues: ['background'],
    generatedAt: Date.now(),
    validUntil: Date.now() + 60000,
  });
  show();
  expect(await screen.findByRole('status')).toHaveTextContent('Android ogranicza pracę Rodziny w tle');
  expect(screen.getByRole('status')).toHaveTextContent('1 z 1');
  expect(screen.getByRole('status')).not.toHaveTextContent('Sprawdź zgody');
});

it('explains an empty future schedule without implying that an alarm will fire', async () => {
  mocks.sync.mockResolvedValue({
    count: 0,
    total: 0,
    complete: true,
    issues: [],
    generatedAt: Date.now(),
    validUntil: Date.now() + 60000,
  });
  show();
  expect(await screen.findByRole('status')).toHaveTextContent('nie ma przyszłych przypomnień dla Twojego konta');
  expect(screen.queryByText(/Najbliższy zapisany alarm:/)).not.toBeInTheDocument();
});
