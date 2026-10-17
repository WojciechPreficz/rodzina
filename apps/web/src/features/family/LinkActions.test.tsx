import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
const f = vi.hoisted(() => ({ copy: vi.fn(async () => {}), share: vi.fn(async () => {}) }));
vi.mock('@capacitor/core', () => ({ registerPlugin: () => f }));
vi.mock('../../platform.js', () => ({ isAndroid: () => true }));
import { LinkActions } from './LinkActions.js';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it('copies and shares through Android even when web APIs are missing', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  const url = 'https://rodzina.preficze.pl/zaproszenie/token';
  render(
    <MantineProvider env="test">
      <LinkActions link={url} shareTitle="Zaproszenie" />
    </MantineProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Kopiuj' }));
  await waitFor(() => expect(f.copy).toHaveBeenCalledWith({ url }));
  fireEvent.click(screen.getByRole('button', { name: 'Udostępnij' }));
  await waitFor(() => expect(f.share).toHaveBeenCalledWith({ url, title: 'Zaproszenie' }));
});
