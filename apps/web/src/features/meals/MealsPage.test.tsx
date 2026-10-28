import '../../offline/testSetup.js';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MantineProvider } from '@mantine/core';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MealsPage } from './MealsPage.js';
import { MealForm } from './MealForm.js';
import { mealWeekStart, shiftMealDate } from './mealDates.js';
import { allowNavigation } from '../../nativeNavigation.js';
import { activateOfflineAccount, transact } from '../../offline/database.js';
import { readOperations } from '../../offline/outbox.js';
import { restoreMeals, stopMeals } from './mealOffline.js';
import type { ShoppingSession } from '../shopping/shoppingOffline.js';

const session = vi.hoisted(() => ({
  user: { id: 'user', role: 'admin' },
  family: { id: 'family', timezone: 'Europe/Warsaw' },
  familyConfirmed: true,
}));
const connection = vi.hoisted(() => ({ offline: false }));
vi.mock('../../sessionContext.js', () => ({ useMe: () => session }));
vi.mock('../../connectivity.js', () => ({ useOffline: () => connection.offline, isOffline: () => connection.offline }));
let client: QueryClient;
let request: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>>;
function mount(component = <MealsPage />) {
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider env="test">{component}</MantineProvider>
    </QueryClientProvider>,
  );
}
beforeEach(async () => {
  session.user.role = 'admin';
  connection.offline = false;
  onlineManager.setOnline(true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await activateOfflineAccount('family:user');
  await restoreMeals(client, session as unknown as ShoppingSession);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  Element.prototype.scrollIntoView = vi.fn();
  request = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/suggestions'))
      return {
        ok: true,
        suggestions: [{ title: 'Pomidorowa', ingredients: [{ name: 'Pomidory', quantity: '1 kg' }] }],
      };
    if (init?.method) return { ok: true, copied: 5 };
    const week = new URL(url, 'http://localhost').searchParams.get('weekStart')!;
    return {
      ok: true,
      weekStart: week,
      days: Array.from({ length: 7 }, (_, i) => ({ date: shiftMealDate(week, i), meals: [] })),
    };
  });
});
vi.mock('../../api.js', async (original) => ({
  ...(await original<typeof import('../../api.js')>()),
  apiFetch: (url: string, init?: RequestInit) => request(url, init),
}));
afterEach(() => {
  cleanup();
  stopMeals();
  onlineManager.setOnline(true);
  client?.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('fills ingredients from a suggestion and saves editable quantities and notes', async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  mount(<MealForm account="family:user" disabled={false} pending={false} onSave={save} onCancel={vi.fn()} />);
  const title = screen.getByRole('textbox', { name: 'Nazwa dania' });
  fireEvent.change(title, { target: { value: 'Pom' } });
  fireEvent.click(await screen.findByRole('option', { name: 'Pomidorowa' }));
  expect(screen.getByRole('textbox', { name: 'Składnik 1' })).toHaveValue('Pomidory');
  fireEvent.change(screen.getByLabelText('Ilość 1'), { target: { value: '2 kg' } });
  fireEvent.change(screen.getByLabelText('Notatka'), { target: { value: 'Na dwa dni' } });
  fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({
      title: 'Pomidorowa',
      notes: 'Na dwa dni',
      ingredients: [{ name: 'Pomidory', quantity: '2 kg' }],
    }),
  );
});
it('focuses each newly added ingredient without stealing focus on subsequent edits', () => {
  mount(<MealForm account="family:user" disabled={false} pending={false} onSave={vi.fn()} onCancel={vi.fn()} />);
  const add = screen.getByRole('button', { name: 'Dodaj składnik' });
  add.focus();
  fireEvent.click(add);
  const first = screen.getByRole('textbox', { name: 'Składnik 1' });
  expect(first).toHaveFocus();
  fireEvent.change(first, { target: { value: 'Ryż' } });
  expect(first).toHaveFocus();
  const quantity = screen.getByRole('textbox', { name: 'Ilość 1' });
  quantity.focus();
  fireEvent.change(quantity, { target: { value: '200 g' } });
  expect(quantity).toHaveFocus();
  add.focus();
  fireEvent.click(add);
  expect(screen.getByRole('textbox', { name: 'Składnik 2' })).toHaveFocus();
  expect(first).toHaveValue('Ryż');
});
it('validates ingredients, protects dirty input and preserves it on a save failure', async () => {
  const save = vi.fn().mockRejectedValue(new Error('Błąd zapisu'));
  mount(<MealForm account="family:user" disabled={false} pending={false} onSave={save} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Nazwa dania' }), { target: { value: 'Obiad' } });
  fireEvent.click(screen.getByRole('button', { name: 'Dodaj składnik' }));
  fireEvent.submit(screen.getByRole('button', { name: 'Zapisz' }).closest('form')!);
  expect(await screen.findByRole('alert')).toHaveTextContent('Podaj nazwę');
  expect(save).not.toHaveBeenCalled();
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  expect(allowNavigation()).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Usuń składnik 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
  expect(await screen.findByText('Błąd zapisu')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Nazwa dania' })).toHaveValue('Obiad');
});
it('navigates weeks and explicitly chooses whether to overwrite when copying', async () => {
  mount();
  await screen.findAllByRole('article');
  const initial = request.mock.calls.find(([url]) => String(url).includes('weekStart='))![0] as string;
  const start = new URL(initial, 'http://localhost').searchParams.get('weekStart')!;
  fireEvent.click(screen.getByRole('button', { name: 'Następny tydzień' }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(`/api/meals?weekStart=${shiftMealDate(start, 7)}`, expect.anything()),
  );
  await screen.findAllByRole('article');
  fireEvent.click(screen.getByRole('button', { name: 'Skopiuj poprzedni tydzień' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('checkbox')).not.toBeChecked();
  fireEvent.click(within(dialog).getByRole('checkbox'));
  onlineManager.setOnline(false);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Kopiuj' }));
  await screen.findByText('Skopiowano obiadów: 0.');
  const operations = await transact('readonly', (tx) => readOperations(tx, 'family:user'));
  expect(operations).toEqual([
    expect.objectContaining({
      module: 'meals',
      payload: {
        type: 'write',
        weekStart: shiftMealDate(start, 7),
        writes: [],
      },
    }),
  ]);
});
it('shows seven read-only days for a child', async () => {
  session.user.role = 'child';
  mount();
  expect(await screen.findAllByRole('article')).toHaveLength(7);
  expect(screen.getAllByText('Brak zaplanowanego obiadu.')).toHaveLength(7);
  expect(screen.queryByRole('button', { name: /Dodaj obiad/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Skopiuj poprzedni tydzień' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Dodaj składniki do listy zakupów' })).not.toBeInTheDocument();
});
it('durably saves when connectivity changes after opening the editor', async () => {
  mount();
  fireEvent.click((await screen.findAllByRole('button', { name: /Dodaj obiad:/ }))[0]!);
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Nazwa dania' }), { target: { value: 'Obiad' } });
  connection.offline = true;
  onlineManager.setOnline(false);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
  await screen.findByText('Obiad został zapisany.', {}, { timeout: 5000 });
  expect(await screen.findByRole('heading', { name: 'Obiad' })).toBeInTheDocument();
  expect(request.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method)).toBe(false);
});
it('shows loading errors without presenting the week as empty', async () => {
  request.mockRejectedValue(new Error('Błąd'));
  mount();
  await screen.findByText('Nie udało się pobrać planu obiadów');
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Skopiuj poprzedni tydzień' })).toBeDisabled();
});
it('computes Mondays and week shifts across year and daylight-saving boundaries', () => {
  expect(mealWeekStart('2027-01-03')).toBe('2026-12-28');
  expect(shiftMealDate('2026-03-23', 7)).toBe('2026-03-30');
});
