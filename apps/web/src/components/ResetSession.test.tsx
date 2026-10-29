import { MantineProvider } from '@mantine/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ResetPasswordPage } from './JoinPages.js';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), logout: vi.fn(), refresh: vi.fn(), user: { id: 'current-user' } }));
vi.mock('../api.js', () => ({ apiFetch: mocks.fetch, sanitizeNextPath: () => '/' }));
vi.mock('../sessionContext.js', () => ({
  useMe: () => ({ user: mocks.user, logout: mocks.logout, refresh: mocks.refresh }),
}));
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  mocks.logout.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it.each([true, false])('clears the local account only when resetOwnSession=%s', async (resetOwnSession) => {
  mocks.fetch.mockResolvedValue({ ok: true, resetOwnSession });
  render(
    <MantineProvider>
      <MemoryRouter initialEntries={['/reset-hasla/token']}>
        <Routes>
          <Route path="/reset-hasla/:token" element={<ResetPasswordPage />} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
  fireEvent.change(screen.getByLabelText(/^Nowe hasło/), { target: { value: 'newPassword123' } });
  fireEvent.change(screen.getByLabelText(/^Powtórz hasło/), { target: { value: 'newPassword123' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Zapisz' })));
  expect(screen.getByRole('status')).toHaveTextContent('Hasło zostało zmienione');
  expect(mocks.logout).toHaveBeenCalledTimes(resetOwnSession ? 1 : 0);
  expect(mocks.refresh).toHaveBeenCalledTimes(resetOwnSession ? 0 : 1);
});
