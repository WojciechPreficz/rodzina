import '../../offline/testSetup.js';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MantineProvider } from '@mantine/core';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Meal } from '@rodzina/shared';
import { ApiRequestError, apiFetch } from '../../api.js';
import { MealShoppingDialog } from './MealShoppingDialog.js';
import { TodayMeal } from './TodayMeal.js';
import { shiftMealDate } from './mealDates.js';
import { restoreShopping, stopShoppingPersistence, type ShoppingSession } from '../shopping/shoppingOffline.js';
import { restoreMeals, stopMeals, saveMealWeek, mealRevision } from './mealOffline.js';

const session = vi.hoisted(() => ({
  user: { id: '33333333-3333-4333-8333-333333333333', familyId: '11111111-1111-4111-8111-111111111111', role: 'admin' },
  family: { id: '11111111-1111-4111-8111-111111111111', timezone: 'Pacific/Kiritimati' },
  familyConfirmed: true,
}));
const connection = vi.hoisted(() => ({ offline: false }));
vi.mock('../../sessionContext.js', () => ({ useMe: () => session }));
vi.mock('../../connectivity.js', () => ({ useOffline: () => connection.offline, isOffline: () => connection.offline }));
vi.mock('../../api.js', async (original) => ({
  ...(await original<typeof import('../../api.js')>()),
  apiFetch: vi.fn(),
}));
vi.mock('../calendar/toScheduleX.js', () => ({
  todayInTimezone: (zone: string) => (zone === 'Pacific/Kiritimati' ? '2026-10-29' : '2026-10-28'),
}));
const listId = '11111111-1111-4111-8111-111111111111';
const meal: Meal = {
  id: '22222222-2222-4222-8222-222222222222',
  familyId: listId,
  date: '2026-10-29',
  slot: 'dinner',
  title: 'Pomidorowa',
  notes: 'Na dwa dni',
  ingredients: [{ name: 'Pomidory', quantity: '1 kg' }],
  createdBy: null,
  createdAt: 1,
  updatedAt: 1,
};
let client: QueryClient;
function mount(component: React.ReactNode) {
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider env="test">
        <MemoryRouter>{component}</MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
}
beforeEach(async () => {
  connection.offline = false;
  onlineManager.setOnline(true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  session.family.timezone = 'Pacific/Kiritimati';
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation(async (url) => {
    if (url === '/api/auth/me') return session;
    if (url.includes('/items')) return { items: [] };
    if (url === '/api/shopping/lists')
      return {
        ok: true,
        lists: [
          { id: listId, familyId: listId, name: 'Dom', position: 0, createdBy: null, createdAt: 1, updatedAt: 1 },
        ],
      };
    if (url.startsWith('/api/meals?'))
      return {
        ok: true,
        weekStart: '2026-10-26',
        days: Array.from({ length: 7 }, (_, i) => ({
          date: shiftMealDate('2026-10-26', i),
          meals: i === 3 ? [meal] : [],
        })),
      };
    return { ok: true, added: 1, updated: 2, items: [], aliases: {} };
  });
  await restoreShopping(client, session as unknown as ShoppingSession);
  await restoreMeals(client, session as unknown as ShoppingSession);
});
afterEach(() => {
  cleanup();
  stopMeals();
  stopShoppingPersistence(client);
  client.clear();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function seedMeals() {
  await saveMealWeek(await apiFetch('/api/meals?weekStart=2026-10-26'), mealRevision('2026-10-26'));
}
async function chooseList() {
  await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/api/shopping/lists', expect.anything()));
  fireEvent.click(screen.getByRole('textbox', { name: 'Lista zakupów' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Dom' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Dodaj składniki' })).toBeEnabled());
}
const dialog = () => (
  <MealShoppingDialog
    week="2026-10-26"
    meals={[meal, { ...meal, id: listId, title: 'Bez składników', ingredients: [] }]}
    onClose={vi.fn()}
  />
);
it('exports only selected meals, blocks empty selections and reports added and updated positions', async () => {
  await seedMeals();
  mount(dialog());
  await chooseList();
  const selected = screen.getByRole('checkbox', { name: /Pomidorowa/ });
  expect(screen.getByRole('checkbox', { name: /Bez składników/ })).toBeDisabled();
  fireEvent.click(selected);
  expect(screen.getByRole('button', { name: 'Dodaj składniki' })).toBeDisabled();
  fireEvent.click(selected);
  fireEvent.click(screen.getByRole('button', { name: 'Dodaj składniki' }));
  await waitFor(() => {
    expect(screen.queryByRole('alert')?.textContent).toBeUndefined();
    expect(screen.queryByRole('status')).toBeInTheDocument();
  });
  expect(await screen.findByText('Dodano pozycji: 1. Uzupełniono pozycji: 2.')).toBeInTheDocument();
  expect(apiFetch).toHaveBeenCalledWith(
    expect.stringMatching(/operationId=[\da-f-]{36}&actorId=[\da-f-]{36}$/),
    expect.objectContaining({
      body: expect.stringContaining('"snapshot":[{"mealId"'),
    }),
  );
});
it('requires confirmation for a repeated export and retries an uncertain response using the same payload and ID', async () => {
  await seedMeals();
  const original = vi.mocked(apiFetch).getMockImplementation()!;
  let sends = 0;
  vi.mocked(apiFetch).mockImplementation(async (url, init) => {
    if (!init?.method) return original(url, init);
    sends++;
    if (sends === 1) throw new ApiRequestError('Powtórzenie', 409, 'MEAL_EXPORT_CONFIRMATION_REQUIRED');
    if (sends === 2) throw new TypeError('Failed to fetch');
    return { ok: true, added: 0, updated: 1, items: [], aliases: {} };
  });
  mount(dialog());
  await chooseList();
  fireEvent.click(screen.getByRole('button', { name: 'Dodaj składniki' }));
  expect(await screen.findByRole('button', { name: 'Dodaj ponownie' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Potwierdzam ponowne dodanie ilości' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dodaj ponownie' }));
  await screen.findByText('Dodano pozycji: 0. Uzupełniono pozycji: 1.', {}, { timeout: 8000 });
  const calls = vi.mocked(apiFetch).mock.calls.filter(([, init]) => init?.method);
  expect(calls[1]![0]).toEqual(calls[2]![0]);
  expect(calls[1]![1]!.body).toEqual(calls[2]![1]!.body);
  expect(calls[0]![0]).toBe(calls[1]![0]);
  expect(JSON.parse(calls[1]![1]!.body as string).confirmRepeat).toBe(true);
}, 15000);
it('shows empty lists and list loading failures without allowing export', async () => {
  vi.mocked(apiFetch).mockRejectedValue(new Error('Failure'));
  mount(dialog());
  await screen.findByText('Nie udało się pobrać list zakupów.');
  expect(screen.getByRole('button', { name: 'Dodaj składniki' })).toBeDisabled();
  vi.mocked(apiFetch).mockResolvedValue({ ok: true, lists: [] });
  fireEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
  await screen.findByText(/Nie masz listy zakupów/);
});
it('shows today in the family timezone, independently of the calendar date', async () => {
  mount(<TodayMeal />);
  await screen.findByText('Pomidorowa');
  expect(screen.getByText('Na dwa dni')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Przejdź do planu obiadów' })).toHaveAttribute('href', '/obiady');
});
it('distinguishes a missing dinner from an unavailable dinner', async () => {
  session.family.timezone = 'Europe/Warsaw';
  const view = mount(<TodayMeal />);
  await screen.findByText('Brak zaplanowanego obiadu na dziś.');
  connection.offline = true;
  view.rerender(
    <QueryClientProvider client={client}>
      <MantineProvider env="test">
        <MemoryRouter>
          <TodayMeal />
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
  expect(screen.getByText(/Zapisany plan offline/)).toBeInTheDocument();
  expect(screen.getByText('Brak zaplanowanego obiadu na dziś.')).toBeInTheDocument();
});
it('reports a today loading error rather than an empty plan', async () => {
  vi.mocked(apiFetch).mockRejectedValue(new Error('Failure'));
  mount(<TodayMeal />);
  await screen.findByRole('alert');
  expect(screen.queryByText('Brak zaplanowanego obiadu na dziś.')).not.toBeInTheDocument();
});
