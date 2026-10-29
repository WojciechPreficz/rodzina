import { MantineProvider } from '@mantine/core';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ForgotPasswordPage, PasswordRecoveryLink } from './PasswordRecovery.js';
import { ApiRequestError } from '../api.js';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../api.js', async (original) => ({
  ...(await original<typeof import('../api.js')>()),
  apiFetch: mocks.fetch,
}));
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  mocks.fetch.mockResolvedValue({ enabled: true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const show = (element = <ForgotPasswordPage />) =>
  render(
    <MantineProvider>
      <MemoryRouter>{element}</MemoryRouter>
    </MantineProvider>,
  );

it('shows recovery only when available and does not expose an action while disabled', async () => {
  mocks.fetch.mockResolvedValue({ enabled: false });
  show(
    <>
      <PasswordRecoveryLink />
      <ForgotPasswordPage />
    </>,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('niedostępne');
  expect(screen.queryByRole('link', { name: 'Nie pamiętam hasła' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Wyślij link do zmiany hasła' })).toBeDisabled();
});
it('validates email, prevents duplicate submission and confirms without promising delivery', async () => {
  show();
  const submit = screen.getByRole('button', { name: 'Wyślij link do zmiany hasła' });
  await waitFor(() => expect(submit).toBeEnabled());
  fireEvent.submit(submit.closest('form')!);
  expect(screen.getByText('E-mail jest niepoprawny.')).toBeVisible();
  fireEvent.change(screen.getByLabelText(/^E-mail/), { target: { value: '  person@example.com  ' } });
  let complete!: (value: object) => void;
  mocks.fetch.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  fireEvent.submit(submit.closest('form')!);
  expect(submit).toBeDisabled();
  fireEvent.submit(submit.closest('form')!);
  expect(mocks.fetch.mock.calls.filter(([url]) => url === '/api/auth/forgot-password')).toHaveLength(1);
  expect(mocks.fetch).toHaveBeenCalledWith(
    '/api/auth/forgot-password',
    expect.objectContaining({ body: JSON.stringify({ email: 'person@example.com' }) }),
  );
  await act(async () => complete({ ok: true }));
  expect(screen.getByRole('status')).toHaveTextContent('Jeśli istnieje konto');
  expect(screen.getByRole('status')).toHaveTextContent('Spam');
});
it.each([
  new ApiRequestError('Za dużo prób. Spróbuj później.', 429),
  new ApiRequestError('Odzyskiwanie hasła jest niedostępne.', 503),
  new TypeError('Failed to fetch'),
])('shows request errors and lets the user retry', async (error) => {
  show();
  const submit = screen.getByRole('button', { name: 'Wyślij link do zmiany hasła' });
  await waitFor(() => expect(submit).toBeEnabled());
  mocks.fetch.mockRejectedValueOnce(error);
  fireEvent.change(screen.getByLabelText(/^E-mail/), { target: { value: 'person@example.com' } });
  fireEvent.click(submit);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    error instanceof ApiRequestError ? error.message : 'Sprawdź internet',
  );
  expect(submit).toBeEnabled();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('does not queue requests offline', async () => {
  show();
  const submit = screen.getByRole('button', { name: 'Wyślij link do zmiany hasła' });
  await waitFor(() => expect(submit).toBeEnabled());
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  fireEvent.change(screen.getByLabelText(/^E-mail/), { target: { value: 'person@example.com' } });
  fireEvent.click(submit);
  expect(await screen.findByRole('alert')).toHaveTextContent('wymaga połączenia');
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it('rechecks availability after the initial connection fails', async () => {
  mocks.fetch.mockRejectedValueOnce(new TypeError('offline'));
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Spróbuj ponownie' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Wyślij link do zmiany hasła' })).toBeEnabled());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
