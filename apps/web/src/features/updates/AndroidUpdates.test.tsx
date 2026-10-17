import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AndroidDownload, AndroidVersion } from './AndroidUpdates.js';
import type { UpdateState } from './updateService.js';

const mocks = vi.hoisted(() => ({ android: false, fetch: vi.fn(), state: { busy: null } as UpdateState }));
vi.mock('../../platform.js', () => ({ isAndroid: () => mocks.android }));
vi.mock('./updateService.js', () => ({
  fetchWebRelease: () => mocks.fetch(),
  nativeUpdates: {},
  updateService: { snapshot: () => mocks.state, subscribe: () => () => undefined },
}));
const release = {
  versionCode: 2,
  versionName: '1.0.1',
  apkUrl: 'https://rodzina.preficze.pl/downloads/android/rodzina-2-1.0.1.apk',
  sha256: 'ab'.repeat(32),
};
beforeEach(() => {
  mocks.android = false;
  mocks.state = { busy: null };
  mocks.fetch.mockResolvedValue(release);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const show = (element = <AndroidDownload />) => render(<MantineProvider>{element}</MantineProvider>);
it('shows a validated version and download instructions in the browser', async () => {
  show();
  expect(await screen.findByRole('link', { name: 'Pobierz aplikację na Androida' })).toHaveAttribute(
    'href',
    release.apkUrl,
  );
  expect(screen.getByText('Wersja Androida: 1.0.1')).toBeInTheDocument();
});
it('shows no broken link when APK is not published or the request fails', async () => {
  mocks.fetch.mockRejectedValue(new Error('offline'));
  show();
  expect(await screen.findByText('Wydanie Androida jest obecnie niedostępne.')).toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
it('hides website download inside the APK', () => {
  mocks.android = true;
  show();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.queryByText('Wydanie Androida jest obecnie niedostępne.')).not.toBeInTheDocument();
});
it('shows installed version and only offers update for an available newer release', () => {
  mocks.state = { busy: null, installed: { code: 1, name: '1.0.0' }, release };
  show(<AndroidVersion />);
  expect(screen.getByText('Zainstalowana wersja: 1.0.0')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Aktualizuj' })).toBeInTheDocument();
  cleanup();
  mocks.state = { busy: null, result: 'current' };
  show(<AndroidVersion />);
  expect(screen.queryByRole('button', { name: 'Aktualizuj' })).not.toBeInTheDocument();
});
