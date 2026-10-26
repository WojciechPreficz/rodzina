import '../../offline/testSetup.js';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { ShoppingItem, ShoppingList } from '@rodzina/shared';
import { ShoppingPage } from './ShoppingPage.js';
import { MemoryRouter } from 'react-router';
import { restoreShopping, stopShoppingPersistence, type ShoppingSession } from './shoppingOffline.js';
import { readShoppingData } from './shoppingStorage.js';
import { shoppingKey } from './shoppingOptimistic.js';

const session = vi.hoisted(() => ({
  user: { id: 'adult', familyId: 'family', role: 'member', displayName: 'Ania' },
  family: { id: 'family' },
}));
vi.mock('../../auth.js', () => ({ useMe: () => session }));
vi.mock('../family/familyQueries.js', () => ({
  useMembersQuery: () => ({ data: [{ id: 'adult', displayName: 'Ania' }] }),
}));

const list: ShoppingList = {
  id: 'list',
  familyId: 'family',
  name: 'Zakupy',
  position: 0,
  createdBy: 'adult',
  createdAt: 1,
  updatedAt: 1,
};
const item: ShoppingItem = {
  id: 'milk',
  listId: 'list',
  name: 'Mleko',
  quantity: '2l',
  category: 'dairy',
  position: 0,
  isChecked: false,
  checkedBy: null,
  checkedAt: null,
  createdBy: 'adult',
  createdAt: 1,
  updatedAt: 1,
};
let client: QueryClient;

async function setup(initial: ShoppingItem[] = [item], patch?: () => Promise<Response>) {
  let items = [...initial];
  let lists = [list];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input).split('?')[0]!;
    const method = init?.method ?? 'GET';
    let body: unknown;
    const data = init?.body ? JSON.parse(String(init.body)) : {};
    if (url === '/api/auth/me') body = session;
    else if (url.includes('/suggestions')) body = { suggestions: [{ name: 'Mleko', category: 'dairy' }] };
    else if (url === '/api/shopping/lists' && method === 'GET') body = { lists };
    else if (url === '/api/shopping/lists' && method === 'POST') {
      lists = [...lists, { ...list, id: 'second', name: data.name }];
      body = { list: lists[1] };
    } else if (url === '/api/shopping/lists/list/items' && method === 'GET') body = { items };
    else if (url.endsWith('/items') && method === 'POST') {
      items = [...items, { ...item, ...data, id: 'new' }];
      body = { item: items.at(-1) };
    } else if (url === '/api/shopping/items/milk' && method === 'PATCH') {
      if (patch) return patch();
      items = items.map((old) =>
        old.id === 'milk' ? { ...old, ...data, checkedBy: data.isChecked ? session.user.id : null } : old,
      );
      body = { item: items[0] };
    } else if (url.endsWith('/clear-checked')) {
      items = items.filter((old) => !old.isChecked);
      body = { deletedCount: 1 };
    } else if (url === '/api/shopping/lists/list' && method === 'PATCH') {
      lists = [{ ...list, name: data.name }];
      body = { list: lists[0] };
    } else body = { items: [] };
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, ...(body as object) }) } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await restoreShopping(client, session as ShoppingSession);
  render(
    <QueryClientProvider client={client}>
      <MantineProvider env="test">
        <MemoryRouter initialEntries={['/zakupy']}>
          <ShoppingPage />
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

describe('shopping UI', () => {
  beforeEach(() => {
    vi.stubGlobal('scrollTo', vi.fn());
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    session.user = { id: 'adult', familyId: 'family', role: 'member', displayName: 'Ania' };
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((media: string) => ({
        media,
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    );
  });
  afterEach(() => {
    stopShoppingPersistence(client);
    focusManager.setFocused(undefined);
    cleanup();
    client?.clear();
    onlineManager.setOnline(true);
    vi.unstubAllGlobals();
  });

  it.each([
    ['mleko 2l', 'mleko', '2l'],
    ['jajka 10 szt', 'jajka', '10 szt'],
  ])('quick-adds %s with a separate quantity', async (input, name, quantity) => {
    const fetchMock = await setup([]);
    const field = await screen.findByRole('textbox', { name: 'Dodaj produkt' });
    await waitFor(() => expect(field).toBeEnabled());
    fireEvent.change(field, { target: { value: input } });
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj' }));
    await waitFor(
      () =>
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringContaining('/api/shopping/lists/list/items?operationId='),
          expect.objectContaining({ method: 'POST', body: JSON.stringify({ name, quantity }) }),
        ),
      { timeout: 4000 },
    );
    await waitFor(() => expect(field).toHaveValue(''));
    expect(await screen.findByRole('article', { name })).toHaveTextContent(quantity);
  });

  it('offers history suggestions and sends their category while keeping the quantity', async () => {
    const fetchMock = await setup([]);
    const field = await screen.findByRole('textbox', { name: 'Dodaj produkt' });
    await waitFor(() => expect(field).toBeEnabled());
    fireEvent.change(field, { target: { value: 'ml 2l' } });
    fireEvent.focus(field);
    fireEvent.click(await screen.findByRole('option', { name: 'Mleko 2l' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/shopping/lists/list/items?operationId='),
        expect.objectContaining({ body: JSON.stringify({ name: 'Mleko', quantity: '2l', category: 'dairy' }) }),
      ),
    );
  });

  it('hides management and other authors item actions from children', async () => {
    session.user = { id: 'child', familyId: 'family', role: 'child', displayName: 'Zosia' };
    await setup([
      item,
      { ...item, id: 'own', name: 'Jabłka', createdBy: 'child', category: 'fruit_vegetables' },
      { ...item, id: 'checked', name: 'Chleb', isChecked: true, checkedBy: null },
    ]);
    expect(await screen.findByRole('checkbox', { name: 'Kupione: Mleko' })).toBeEnabled();
    expect(screen.getByRole('textbox', { name: 'Dodaj produkt' })).toBeEnabled();
    for (const name of ['Dodaj listę', 'Zmień nazwę listy', 'Usuń listę', 'Wyczyść kupione', 'Opcje: Mleko'])
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Opcje: Jabłka' }));
    expect(await screen.findByRole('menuitem', { name: 'Edytuj' })).toBeInTheDocument();
    expect(await screen.findByRole('menuitem', { name: 'Usuń' })).toBeInTheDocument();
    expect(screen.getByText('kupił(a): były domownik')).toBeInTheDocument();
  });

  it('checks optimistically, moves to the bottom and rolls back a failed save', async () => {
    let finish!: (response: Response) => void;
    await setup(
      [item, { ...item, id: 'bread', name: 'Chleb', category: 'bakery' }],
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Kupione: Mleko' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Kupione: Mleko' })).toBeChecked());
    expect(screen.getAllByRole('article').map((row) => row.getAttribute('aria-label'))).toEqual(['Chleb', 'Mleko']);
    expect(screen.getByText('kupił(a): Ania')).toBeInTheDocument();
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(screen.getByRole('checkbox', { name: 'Kupione: Mleko' })).toBeChecked();
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    finish({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: { message: 'Błąd zapisu' } }),
    } as Response);
    expect(await screen.findByRole('alert')).toHaveTextContent('Błąd zapisu');
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Kupione: Mleko' })).not.toBeChecked());
    expect((await readShoppingData('family:adult'))?.operations[0]?.review).toBe('rejected');
    fireEvent.click(screen.getByRole('button', { name: 'Odrzuć zmiany wymagające sprawdzenia' }));
    const confirmation = await screen.findByRole('dialog');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Odrzuć zmiany' }));
    await waitFor(async () => expect((await readShoppingData('family:adult'))?.operations).toHaveLength(0));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('requires confirmation before clearing checked items', async () => {
    const fetchMock = await setup([{ ...item, isChecked: true, checkedBy: 'adult' }]);
    fireEvent.click(await screen.findByRole('button', { name: 'Wyczyść kupione' }));
    const modal = await screen.findByRole('dialog');
    expect(modal).toHaveTextContent('Usunąć wszystkie kupione produkty');
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/clear-checked'))).toBe(false);
    fireEvent.click(within(modal).getByRole('button', { name: 'Usuń' }));
    expect(await screen.findByText('Lista jest pusta. Dodaj pierwszy produkt.')).toBeInTheDocument();
  });

  it('edits a product name, quantity and category', async () => {
    const fetchMock = await setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Opcje: Mleko' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Edytuj' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Nazwa produktu/ }), { target: { value: 'Kefir' } });
    fireEvent.change(within(dialog).getByLabelText('Ilość'), { target: { value: '1l' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/shopping/items/milk?operationId='),
        expect.objectContaining({ body: JSON.stringify({ name: 'Kefir', quantity: '1l', category: 'dairy' }) }),
      ),
    );
    expect(await screen.findByRole('article', { name: 'Kefir' })).toBeInTheDocument();
  });

  it('creates a list and renames the selected list', async () => {
    await setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Dodaj listę' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /^Nazwa listy/ }), { target: { value: 'Drogeria' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Zapisz' }));
    expect(await screen.findByRole('button', { name: /Drogeria/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Opcje listy' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Zmień nazwę listy' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /^Nazwa listy/ }), { target: { value: 'Spożywcze' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Zapisz' }));
    expect(await screen.findByRole('button', { name: /Spożywcze/ })).toBeInTheDocument();
  });

  it('creates a list, adds and checks a product offline without blocking the next action', async () => {
    const fetchMock = await setup();
    await screen.findByRole('article', { name: 'Mleko' });
    onlineManager.setOnline(false);
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj listę' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /^Nazwa listy/ }), { target: { value: 'Offline' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Zapisz' }));
    fireEvent.click(await screen.findByRole('button', { name: /Offline/ }));
    const field = screen.getByRole('textbox', { name: 'Dodaj produkt' });
    expect(field).toBeEnabled();
    fireEvent.change(field, { target: { value: 'Chleb 2 szt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Kupione: Chleb' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Kupione: Chleb' })).toBeChecked());
    await waitFor(async () => expect((await readShoppingData('family:adult'))?.operations).toHaveLength(3));
    expect(client.isMutating()).toBe(0);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET')).toHaveLength(0);
  });

  it('returns to the catalog with focus and scroll restored', async () => {
    await setup();
    const card = await screen.findByRole('button', { name: 'Zakupy' });
    vi.stubGlobal('scrollY', 320);
    fireEvent.click(card);
    const title = screen.getByRole('heading', { name: 'Zakupy', level: 2 });
    await waitFor(() => expect(title).toHaveFocus());
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    fireEvent.click(screen.getByRole('button', { name: /Wróć do list/ }));
    await waitFor(() => expect(card).toHaveFocus());
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 320);
  });

  it('distinguishes an uncached offline list from an empty list and blocks adding', async () => {
    await setup();
    await screen.findByRole('article', { name: 'Mleko' });
    act(() => {
      client.setQueryData(
        [...shoppingKey({ familyId: 'family', userId: 'adult' }), 'lists'],
        [list, { ...list, id: 'uncached', name: 'Niepobrana' }],
      );
      onlineManager.setOnline(false);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Niepobrana' }));
    expect(await screen.findByText(/Brak zawartości tej listy na urządzeniu/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Dodaj produkt' })).toBeDisabled();
    expect(screen.queryByText('Lista jest pusta. Dodaj pierwszy produkt.')).not.toBeInTheDocument();
  });
});
