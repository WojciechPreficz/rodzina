import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NotificationsPage } from './NotificationsPage.js';
import { NotificationBanner } from './NotificationBanner.js';

const mocks = vi.hoisted(() => ({
  android: false,
  schedule: undefined as
    undefined | { result?: { complete: boolean; issues?: ('background' | 'missing')[] }; error?: string },
}));
vi.mock('../../platform.js', () => ({ isAndroid: () => mocks.android }));
vi.mock('../../auth.js', () => ({ useMe: () => ({ user: { id: 'user', familyId: 'family' } }) }));
vi.mock('./scheduleSync.js', () => ({ useLocalSchedule: () => ({ data: mocks.schedule }) }));
vi.mock('../updates/AndroidUpdates.js', () => ({ AndroidDownload: () => <div>Pobieranie APK</div> }));
vi.mock('./LocalAlarmsPage.js', () => ({ LocalAlarmsPage: () => <div>Alarmy Androida</div> }));
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  mocks.android = false;
  mocks.schedule = undefined;
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

it('explains that reminders require APK and offers the existing download component', () => {
  show();
  expect(screen.getByText('Przypomnienia są dostępne w aplikacji na Androida.')).toBeInTheDocument();
  expect(screen.getByText('Pobieranie APK')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Włącz powiadomienia' })).not.toBeInTheDocument();
});
it('keeps the native alarm settings inside APK', () => {
  mocks.android = true;
  show();
  expect(screen.getByText('Alarmy Androida')).toBeInTheDocument();
  expect(screen.queryByText('Pobieranie APK')).not.toBeInTheDocument();
});
it('does not show a browser push banner', () => {
  show(<NotificationBanner />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('uses local alarm coverage for the Android banner', () => {
  mocks.android = true;
  mocks.schedule = { result: { complete: true } };
  show(<NotificationBanner />);
  expect(screen.queryByRole('link', { name: 'Powiadomienia' })).not.toBeInTheDocument();
  cleanup();
  mocks.schedule = { result: { complete: false } };
  show(<NotificationBanner />);
  expect(screen.getByRole('link', { name: 'Powiadomienia' })).toBeInTheDocument();
});
it('shows the actual Android coverage problem', () => {
  mocks.android = true;
  mocks.schedule = { result: { complete: false, issues: ['background'] } };
  show(<NotificationBanner />);
  expect(screen.getByRole('alert')).toHaveTextContent('Android ogranicza pracę Rodziny w tle');
});
it('distinguishes a failed refresh from missing Android permissions', () => {
  mocks.android = true;
  mocks.schedule = { result: { complete: true }, error: 'offline' };
  show(<NotificationBanner />);
  expect(screen.getByRole('alert')).toHaveTextContent('Nie udało się odświeżyć harmonogramu');
});
