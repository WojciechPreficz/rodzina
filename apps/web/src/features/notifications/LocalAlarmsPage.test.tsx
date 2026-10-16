import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocalAlarmsPage } from './LocalAlarmsPage.js';

const mocks = vi.hoisted(() => ({
  permissions: vi.fn(),
  sync: vi.fn(),
  retry: vi.fn(),
  request: vi.fn(),
  exact: vi.fn(),
}));
vi.mock('../../auth.js', () => ({ useMe: () => ({ user: { id: 'user', familyId: 'family' } }) }));
vi.mock('./localSchedule.js', () => ({ localScheduler: mocks }));
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
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function show() {
  render(
    <MantineProvider>
      <LocalAlarmsPage />
    </MantineProvider>,
  );
}

it('checks permissions without prompting and asks only on explicit clicks', async () => {
  show();
  await screen.findByText('Powiadomienia: brak zgody');
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.sync).not.toHaveBeenCalled();
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
  fireEvent.click(screen.getByRole('button', { name: 'Pobierz i zapisz harmonogram' }));
  expect(await screen.findByRole('status')).toHaveTextContent('nie jest w pełni zabezpieczony');
  expect(screen.getByRole('status')).toHaveTextContent('1 z 2');
  expect(mocks.sync).toHaveBeenCalledWith('family:user');
});
it('shows network or permission errors without a success message', async () => {
  mocks.sync.mockRejectedValue(new Error('Brak zgody'));
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Pobierz i zapisz harmonogram' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Brak zgody');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
