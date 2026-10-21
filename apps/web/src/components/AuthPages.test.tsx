import { MantineProvider } from '@mantine/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LoginPage, RegisterPage } from './AuthPages.js';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), setSession: vi.fn() }));
vi.mock('../api.js', () => ({ apiFetch: mocks.fetch, sanitizeNextPath: () => '/kalendarz' }));
vi.mock('../auth.js', () => ({ useMe: () => ({ setSession: mocks.setSession }) }));

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  { Component: LoginPage, submit: 'Zaloguj się', endpoint: '/api/auth/login' },
  { Component: RegisterPage, submit: 'Utwórz rodzinę', endpoint: '/api/auth/register-family' },
])('shows pending and API errors without duplicate submissions: $endpoint', async ({ Component, submit, endpoint }) => {
  let rejectRequest!: (error: Error) => void;
  mocks.fetch.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectRequest = reject;
      }),
  );
  render(
    <MantineProvider>
      <MemoryRouter>
        <Component />
      </MemoryRouter>
    </MantineProvider>,
  );
  for (const [name, value] of [
    ['Nazwa rodziny', 'Nasz dom'],
    ['Twoje imię', 'Anna'],
    ['E-mail', 'anna@example.com'],
    ['Hasło', 'password123'],
  ] as const) {
    const input = screen.queryByLabelText(name, { exact: true });
    if (input) fireEvent.change(input, { target: { value } });
  }
  const button = screen.getByRole('button', { name: submit });
  fireEvent.submit(button.closest('form')!);
  expect(button).toBeDisabled();
  fireEvent.submit(button.closest('form')!);
  expect(mocks.fetch).toHaveBeenCalledOnce();
  expect(mocks.fetch).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method: 'POST' }));
  await act(async () => rejectRequest(new Error('Brak połączenia. Spróbuj ponownie.')));
  expect(screen.getByRole('alert')).toHaveTextContent('Brak połączenia. Spróbuj ponownie.');
  expect(button).toBeEnabled();
  expect(mocks.setSession).not.toHaveBeenCalled();
});
