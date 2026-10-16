import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NotificationsPage } from './NotificationsPage.js';
import { NotificationBanner } from './NotificationBanner.js';

const mocks = vi.hoisted(() => ({
  status: {
    data: undefined as
      | undefined
      | { supported: boolean; permission: NotificationPermission; subscribed: boolean; hasReminders: boolean },
    isPending: false,
    error: null,
  },
  enable: { mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null },
  test: {
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    error: null,
    data: undefined as undefined | { sent: number; failed: number; removed: number },
  },
}));
vi.mock('./pushQueries.js', () => ({ usePushStatus: () => mocks.status, usePushActions: () => mocks }));
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  mocks.status.data = { supported: true, permission: 'default', subscribed: false, hasReminders: false };
  mocks.test.data = undefined;
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function show(element = <NotificationsPage />) {
  render(
    <MantineProvider>
      <MemoryRouter>{element}</MemoryRouter>
    </MantineProvider>,
  );
}

it.each([
  [false, 'default', false, 'nie są obsługiwane'],
  [true, 'denied', false, 'są zablokowane'],
  [true, 'granted', true, 'są włączone'],
  [true, 'granted', false, 'są wyłączone'],
] as const)('shows device status %s %s %s', (supported, permission, subscribed, message) => {
  mocks.status.data = { supported, permission, subscribed, hasReminders: false };
  show();
  expect(screen.getByRole('status')).toHaveTextContent(message);
  expect(mocks.enable.mutate).not.toHaveBeenCalled();
  if (!supported || permission === 'denied')
    expect(screen.queryByRole('button', { name: 'Włącz powiadomienia' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Wyślij testowe' }) !== null).toBe(subscribed);
});
it('enables only after a click and shows Android instructions', () => {
  show();
  expect(screen.getByText(/Zainstaluj aplikację/)).toBeInTheDocument();
  expect(mocks.enable.mutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Włącz powiadomienia' }));
  expect(mocks.enable.mutate).toHaveBeenCalledOnce();
});
it('sends a test on click and reports partial failure', () => {
  mocks.status.data = { supported: true, permission: 'granted', subscribed: true, hasReminders: true };
  mocks.test.data = { sent: 1, failed: 1, removed: 1 };
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Wyślij testowe' }));
  expect(mocks.test.mutate).toHaveBeenCalledOnce();
  expect(screen.getByText(/Przekazano do usługi push: 1/)).toHaveTextContent('Błędy: 1. Wygasłe subskrypcje: 1.');
});
it.each([
  [false, false, 'default', false],
  [true, false, 'default', true],
  [true, true, 'granted', false],
  [true, true, 'denied', true],
] as const)(
  'shows banner for reminders=%s subscription=%s permission=%s',
  (hasReminders, subscribed, permission, visible) => {
    mocks.status.data = { supported: true, hasReminders, subscribed, permission };
    show(<NotificationBanner />);
    expect(screen.queryByText('Włącz powiadomienia, aby dostawać przypomnienia') !== null).toBe(visible);
    if (visible)
      expect(screen.getByRole('link', { name: 'Powiadomienia' })).toHaveAttribute('href', '/wiecej/powiadomienia');
    expect(mocks.enable.mutate).not.toHaveBeenCalled();
  },
);
