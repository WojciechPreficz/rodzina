import { MantineProvider } from '@mantine/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConfirmRegistrationPage } from './ConfirmRegistration.js';

const fetch = vi.hoisted(() => vi.fn());
vi.mock('../api.js', () => ({ apiFetch: fetch }));
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
const token = 'a'.repeat(64);
const show = (hash = `#token=${token}`) =>
  render(
    <MantineProvider>
      <MemoryRouter initialEntries={[`/potwierdz-rodzine${hash}`]}>
        <ConfirmRegistrationPage />
      </MemoryRouter>
    </MantineProvider>,
  );

it('does not consume the link on opening and requires a single explicit confirmation', async () => {
  let finish!: () => void;
  fetch.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  show();
  expect(fetch).not.toHaveBeenCalled();
  const button = screen.getByRole('button', { name: 'Potwierdź i utwórz rodzinę' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(button).toBeDisabled();
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/auth/confirm-registration', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
  await act(async () => finish());
  expect(screen.getByRole('status')).toHaveTextContent('zostały utworzone');
  expect(screen.getByRole('link', { name: 'Zaloguj się' })).toHaveAttribute('href', '/login');
  expect(screen.queryByRole('button', { name: 'Potwierdź i utwórz rodzinę' })).not.toBeInTheDocument();
});

it.each(['', '#token=invalid'])('rejects incomplete links without making a request: %s', (hash) => {
  show(hash);
  expect(screen.getByRole('alert')).toHaveTextContent('nieprawidłowy');
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'Ponów rejestrację' })).toHaveAttribute('href', '/register');
});

it.each(['Link wygasł lub został już wykorzystany.', 'Brak połączenia. Spróbuj ponownie.'])(
  'shows the server error and allows retry: %s',
  async (message) => {
    fetch.mockRejectedValueOnce(new Error(message)).mockResolvedValueOnce({ ok: true });
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Potwierdź i utwórz rodzinę' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    fireEvent.click(screen.getByRole('button', { name: 'Potwierdź i utwórz rodzinę' }));
    expect(await screen.findByRole('status')).toHaveTextContent('zostały utworzone');
  },
);
