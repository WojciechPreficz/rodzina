import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../api.js';
import type { Member } from '@rodzina/shared';
import { DeleteAccountModal } from './DeleteAccountModal.js';

const mocks = vi.hoisted(() => ({
  removeMember: vi.fn(),
  removeFamily: vi.fn(),
  list: vi.fn(),
  fetch: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
  close: vi.fn(),
  readOnly: false,
}));
vi.mock('./familyApi.js', () => ({
  deleteMember: mocks.removeMember,
  deleteFamily: mocks.removeFamily,
  listMembers: mocks.list,
}));
vi.mock('./familyQueries.js', () => ({
  useFamilyReadOnly: () => mocks.readOnly,
  onlineActionHint: 'Dostępne po połączeniu z internetem',
}));
vi.mock('../../connectivity.js', () => ({ isOffline: () => mocks.readOnly }));
vi.mock('../../api.js', async (original) => ({
  ...(await original<typeof import('../../api.js')>()),
  apiFetch: mocks.fetch,
}));
vi.mock('../../sessionContext.js', () => ({
  useMe: () => ({
    user: { id: 'admin', role: 'admin' },
    family: { name: 'Kowalscy' },
    logout: mocks.logout,
    refresh: mocks.refresh,
  }),
}));
const child = { id: 'child', role: 'child', displayName: 'Zosia' } as Member;
let client: QueryClient;
function mount(target: Member | 'family' = child) {
  client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider>
        <DeleteAccountModal target={target} onClose={mocks.close} />
      </MantineProvider>
    </QueryClientProvider>,
  );
}
function password() {
  fireEvent.change(screen.getByLabelText(/^Twoje hasło/), { target: { value: 'password123' } });
}
beforeEach(() => {
  mocks.readOnly = false;
  for (const action of [mocks.removeFamily, mocks.removeMember, mocks.logout, mocks.refresh, mocks.fetch])
    action.mockResolvedValue({ ok: true });
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it('requires a password and refreshes after deleting a child without logging out', async () => {
  mount();
  expect(screen.getByRole('button', { name: 'Usuń trwale' })).toBeDisabled();
  password();
  fireEvent.click(screen.getByRole('button', { name: 'Usuń trwale' }));
  await waitFor(() => expect(mocks.close).toHaveBeenCalled());
  expect(mocks.removeMember).toHaveBeenCalledWith('child', { password: 'password123' });
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(mocks.logout).not.toHaveBeenCalled();
  expect(client.getMutationCache().getAll()).toHaveLength(0);
});
it.each(['family', 'self'] as const)('clears the local session after deleting %s', async (kind) => {
  mount(kind === 'family' ? 'family' : { ...child, id: 'admin', role: 'admin' });
  password();
  if (kind === 'family') {
    expect(screen.getByRole('button', { name: 'Usuń trwale' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Wpisz nazwę rodziny/), { target: { value: 'Kowalscy' } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Usuń trwale' }));
  await waitFor(() => expect(mocks.logout).toHaveBeenCalledOnce());
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it('cancels without sending any request', () => {
  mount('family');
  password();
  fireEvent.click(screen.getByRole('button', { name: 'Anuluj' }));
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(mocks.removeFamily).not.toHaveBeenCalled();
});
it('provides an accessible close button', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Zamknij' }));
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(mocks.removeMember).not.toHaveBeenCalled();
});
it('blocks deletion offline', () => {
  mocks.readOnly = true;
  mount();
  expect(screen.getByLabelText(/^Twoje hasło/)).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Usuń trwale' })).toBeDisabled();
});
it('clears a rejected password and preserves the session', async () => {
  mocks.removeMember.mockRejectedValue(new ApiRequestError('Nieprawidłowe hasło.', 403, 'INVALID_CREDENTIALS'));
  mount();
  password();
  fireEvent.click(screen.getByRole('button', { name: 'Usuń trwale' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Nieprawidłowe hasło.');
  expect(screen.getByLabelText(/^Twoje hasło/)).toHaveValue('');
  expect(mocks.logout).not.toHaveBeenCalled();
});
it('checks an uncertain deletion before allowing another attempt', async () => {
  mocks.removeMember.mockRejectedValue(new TypeError('Failed to fetch'));
  mocks.list.mockResolvedValue([child]);
  mount();
  password();
  fireEvent.click(screen.getByRole('button', { name: 'Usuń trwale' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Sprawdź wynik' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Konto nadal istnieje'));
  expect(mocks.removeMember).toHaveBeenCalledOnce();
  expect(mocks.fetch).toHaveBeenCalledWith('/api/auth/me');
});
it('recognizes a lost success response when the member is absent', async () => {
  mocks.removeMember.mockRejectedValue(new TypeError('Failed to fetch'));
  mocks.list.mockResolvedValue([]);
  mount();
  password();
  fireEvent.click(screen.getByRole('button', { name: 'Usuń trwale' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Sprawdź wynik' }));
  await waitFor(() => expect(mocks.close).toHaveBeenCalled());
  expect(mocks.removeMember).toHaveBeenCalledOnce();
});
it('ignores a late deletion response after the account view is unmounted', async () => {
  let resolve!: (value: unknown) => void;
  mocks.removeFamily.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = mount('family');
  password();
  fireEvent.change(screen.getByLabelText(/^Wpisz nazwę rodziny/), { target: { value: 'Kowalscy' } });
  fireEvent.click(screen.getByRole('button', { name: 'Usuń trwale' }));
  view.unmount();
  resolve({ ok: true });
  await Promise.resolve();
  await Promise.resolve();
  expect(mocks.logout).not.toHaveBeenCalled();
});
