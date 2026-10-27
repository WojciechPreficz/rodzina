import { IDBObjectStore } from 'fake-indexeddb';
import { readCache, writeCache } from '../../offline/database.js';
import '../../offline/testSetup.js';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Contact, ContactGroup } from '@rodzina/shared';
import { ContactsPage } from './ContactsPage.js';
import { contactPhoneHref, matchesContact, sortContacts } from './contactUi.js';
import { allowNavigation, installNativeNavigation } from '../../nativeNavigation.js';
import { theme, cssVariablesResolver } from '../../theme.js';
import { CONTACTS_SIGNAL, contactsStore } from './contactsOffline.js';

const session = vi.hoisted(() => ({
  user: { id: '10000000-0000-4000-8000-000000000002', role: 'admin' },
  family: { id: '10000000-0000-4000-8000-000000000001' },
  familyConfirmed: true,
}));
const connection = vi.hoisted(() => ({ offline: false }));
vi.mock('../../auth.js', () => ({ useMe: () => session }));
vi.mock('../../connectivity.js', () => ({ useOffline: () => connection.offline, isOffline: () => connection.offline }));
const native = vi.hoisted(() => ({ listeners: new Map<string, () => void>() }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (name: string, handler: () => void) => {
      native.listeners.set(name, handler);
      return { remove: vi.fn() };
    }),
    getLaunchUrl: vi.fn(async () => ({})),
    minimizeApp: vi.fn(),
  },
}));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { addListener: vi.fn(async () => ({ remove: vi.fn() })) },
}));
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const meta = { familyId: id(1), createdBy: id(2), createdAt: 1, updatedAt: 1 };
const groups: ContactGroup[] = [
  { ...meta, id: id(3), name: 'Rodzina', isDefault: false },
  { ...meta, id: id(4), name: 'Inne', isDefault: true },
];
const base: Contact = {
  ...meta,
  id: id(5),
  name: 'Łucja Żak',
  groupId: id(3),
  relationship: 'Ciocia',
  phone: '+48 (600) 111-222',
  address: 'ul. Łąkowa 3\nŁódź',
};
let mobileViewport = false;
let client: QueryClient;
let fail = '';
let items: Contact[];
let groupItems: ContactGroup[];
function setup(initial = [base], loadError = false) {
  let nextId = 20;
  items = initial;
  groupItems = [...groups];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (loadError || (fail && method !== 'GET'))
      return new Response(JSON.stringify({ error: { message: fail || 'Błąd pobierania' } }), { status: 400 });
    const data = init?.body ? JSON.parse(String(init.body)) : {};
    if (url === '/api/contacts' && method === 'POST')
      items = [
        ...items,
        {
          ...base,
          ...data,
          id: id(nextId++),
          relationship: data.relationship ?? null,
          phone: data.phone ?? null,
          address: data.address ?? null,
        },
      ];
    if (url.startsWith('/api/contacts/') && method === 'PATCH')
      items = items.map((item) => (item.id === url.split('/').at(-1) ? { ...item, ...data } : item));
    if (url.startsWith('/api/contacts/') && method === 'DELETE')
      items = items.filter((item) => item.id !== url.split('/').at(-1));
    if (url === '/api/contact-groups' && method === 'POST')
      groupItems.push({ ...meta, ...data, id: id(7), isDefault: false });
    if (url.startsWith('/api/contact-groups/') && method === 'PATCH')
      groupItems = groupItems.map((group) => (group.id === url.split('/').at(-1) ? { ...group, ...data } : group));
    if (url.startsWith('/api/contact-groups/') && method === 'DELETE') {
      const removed = url.split('/').at(-1);
      groupItems = groupItems.filter((group) => group.id !== removed);
      items = items.map((item) => (item.groupId === removed ? { ...item, groupId: id(4) } : item));
    }
    return new Response(JSON.stringify({ ok: true, groups: groupItems, contacts: items }));
  });
  vi.stubGlobal('fetch', fetchMock);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MantineProvider theme={theme} cssVariablesResolver={cssVariablesResolver} env="test">
        <ContactsPage />
      </MantineProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}
beforeEach(async () => {
  mobileViewport = false;
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  fail = '';
  connection.offline = false;
  session.user.role = 'admin';
  session.familyConfirmed = true;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: mobileViewport, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});
afterEach(async () => {
  cleanup();
  contactsStore.clear(false);
  client?.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function loaded() {
  return screen.findByRole('button', { name: `Szczegóły kontaktu: ${base.name}` });
}
async function addContact() {
  await loaded();
  fireEvent.click(screen.getByRole('button', { name: '＋ Dodaj kontakt' }));
  return screen.findByRole('dialog');
}

describe('contacts online', () => {
  it('restores persisted contacts offline after remount, with search, details and disabled mutations', async () => {
    setup();
    await loaded();
    expect(await readCache('contacts')).toBeDefined();
    cleanup();
    client.clear();
    await contactsStore.clear(false);
    connection.offline = true;
    session.familyConfirmed = false;
    const fetch = setup();
    await loaded();
    expect(screen.getByText(/Ostatnie udane pobranie:/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '＋ Dodaj kontakt' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Szukaj kontaktu' }), { target: { value: 'lodz' } });
    fireEvent.click(await loaded());
    expect(within(screen.getByRole('dialog')).getByRole('link')).toHaveAttribute('href', 'tel:+48600111222');
    expect(screen.getByRole('button', { name: 'Edytuj' })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('shows denied persistence and reloads a same-account snapshot from another tab', async () => {
    setup();
    await loaded();
    const saved = (await readCache('contacts'))!.payload as { account: string; data: { contacts: { name: string }[] } };
    saved.data.contacts[0]!.name = 'Anna';
    await writeCache('contacts', saved);
    act(() =>
      window.dispatchEvent(new StorageEvent('storage', { key: CONTACTS_SIGNAL, newValue: JSON.stringify(saved) })),
    );
    await screen.findByRole('button', { name: 'Szczegóły kontaktu: Anna' });
    expect(screen.queryByRole('button', { name: `Szczegóły kontaktu: ${base.name}` })).not.toBeInTheDocument();
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new Error('Quota');
    });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['contacts'] });
    });
    expect(await screen.findByText(/Nie można zapisać kontaktów na urządzeniu/)).toBeInTheDocument();
    await loaded();
  });
  it('combines mobile groups, clears to all contacts and keeps search counts independent', async () => {
    mobileViewport = true;
    setup([base, { ...base, id: id(8), groupId: id(4), name: 'Anna' }]);
    await loaded();
    expect(screen.queryByRole('navigation', { name: 'Grupy kontaktów' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Wszystkie kontakty' })).toBeInTheDocument();
    expect(screen.getByText('Kontakty: 2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Usuń grupę' })).not.toBeInTheDocument();
    const filter = screen.getByRole('textbox', { name: 'Filtr kontaktów' });
    fireEvent.click(filter);
    fireEvent.click(screen.getByRole('option', { name: 'Rodzina (1)' }));
    expect(screen.queryByRole('button', { name: 'Szczegóły kontaktu: Anna' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usuń grupę' })).toBeInTheDocument();
    fireEvent.click(filter);
    fireEvent.click(screen.getByRole('option', { name: 'Inne (1)' }));
    expect(screen.getByRole('button', { name: 'Szczegóły kontaktu: Anna' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Wybrane grupy' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Usuń grupę' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Szukaj kontaktu' }), { target: { value: 'Anna' } });
    expect(screen.getByText('Kontakty: 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Wyczyść filtry' }));
    expect(screen.getByRole('heading', { name: 'Wszystkie kontakty' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '＋ Dodaj kontakt' }));
    expect(within(await screen.findByRole('dialog')).getByLabelText('Grupa')).toHaveValue(id(4));
  });
  it('places group creation in the header and offers only the full contact form in the group card', async () => {
    setup();
    await loaded();
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('button', { name: '＋ Dodaj grupę' })).toBeInTheDocument();
    expect(within(header).queryByRole('button', { name: '＋ Dodaj kontakt' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '＋ Dodaj grupę' })).toHaveLength(1);
    expect(screen.queryByRole('textbox', { name: 'Szybkie dodawanie kontaktu' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '＋ Dodaj' })).not.toBeInTheDocument();
    const add = screen.getByRole('button', { name: '＋ Dodaj kontakt' });
    expect(add.closest('.contacts-card')).not.toBeNull();
    expect(add).toHaveAttribute('data-block', 'true');
    fireEvent.click(add);
    const dialog = await screen.findByRole('dialog');
    for (const label of ['Grupa', 'Opis relacji', 'Telefon', 'Adres'])
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument();
  });
  it('sorts Polish names, filters every optional field and telephone separators, and preserves full counts', async () => {
    setup([
      base,
      { ...base, id: id(8), name: 'Zofia', relationship: null, address: null, phone: null },
      { ...base, id: id(9), name: 'Anna' },
    ]);
    await loaded();
    expect(screen.getAllByRole('button', { name: /^Szczegóły kontaktu/ }).map((node) => node.textContent)).toEqual([
      'Anna›',
      'Łucja Żak›',
      'Zofia›',
    ]);
    for (const value of ['LUCJA', 'zak', 'CIOCIA', 'lodz', 'lakowa', '+48 600 111 222']) {
      fireEvent.change(screen.getByRole('textbox', { name: 'Szukaj kontaktu' }), { target: { value } });
      expect(screen.getByText('Kontakty: 3')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Rodzina/ })).toHaveTextContent('3');
      expect(screen.getByRole('button', { name: 'Szczegóły kontaktu: Łucja Żak' })).toBeInTheDocument();
    }
    fireEvent.change(screen.getByRole('textbox', { name: 'Szukaj kontaktu' }), { target: { value: 'nie istnieje' } });
    expect(screen.getByText('Brak wyników wyszukiwania.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Inne/ }));
    expect(screen.getByText('W tej grupie nie ma jeszcze kontaktów.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Usuń grupę' })).not.toBeInTheDocument();
  });
  it('opens details with only present fields and keeps telephone action separate', async () => {
    setup();
    await loaded();
    const link = screen.getByRole('link', { name: base.phone! });
    expect(link).toHaveAttribute('href', 'tel:+48600111222');
    link.addEventListener('click', (event) => event.preventDefault(), { once: true });
    fireEvent.click(link);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(await loaded());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Ciocia')).toBeInTheDocument();
    expect(within(dialog).getByText(/Łąkowa/)).toBeInTheDocument();
  });
  it('saves a complete form, then edits and deletes the contact', async () => {
    const request = setup();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: '＋ Dodaj kontakt' }));
    const form = await screen.findByRole('dialog');
    fireEvent.change(within(form).getByLabelText(/Imię i nazwisko/), { target: { value: 'Ewa' } });
    fireEvent.change(within(form).getByLabelText('Opis relacji'), { target: { value: 'Siostra' } });
    fireEvent.change(within(form).getByLabelText('Telefon'), { target: { value: '+49 123' } });
    fireEvent.change(within(form).getByLabelText('Adres'), { target: { value: 'Berlin\nDom 5' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const saved = request.mock.calls.filter(([, init]) => init?.method === 'POST').at(-1)!;
    expect(JSON.parse(String(saved[1]?.body))).toMatchObject({
      name: 'Ewa',
      phone: '+49 123',
      address: 'Berlin\nDom 5',
      relationship: 'Siostra',
      groupId: id(3),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Szczegóły kontaktu: Ewa' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edytuj' }));
    const editing = await screen.findByRole('dialog');
    fireEvent.change(within(editing).getByLabelText(/Imię i nazwisko/), { target: { value: 'Ewa Nowak' } });
    fireEvent.click(within(editing).getByRole('button', { name: 'Zapisz' }));
    await screen.findByRole('heading', { name: 'Ewa Nowak' });
    fireEvent.click(screen.getByRole('button', { name: 'Usuń kontakt' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Usuń' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Szczegóły kontaktu: Ewa Nowak' })).not.toBeInTheDocument(),
    );
  });
  it('creates and renames groups, confirms deletion and retains their contacts in the default group', async () => {
    setup();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: '＋ Dodaj grupę' }));
    let dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Nazwa grupy/), { target: { value: 'Sąsiedzi' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    await screen.findByRole('button', { name: /Sąsiedzi/ });
    fireEvent.click(screen.getByRole('button', { name: 'Zmień nazwę grupy' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Nazwa grupy/), { target: { value: 'Bliscy' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    await screen.findByRole('heading', { name: 'Bliscy' });
    fireEvent.click(screen.getByRole('button', { name: 'Usuń grupę' }));
    expect(await screen.findByText(/Żaden kontakt nie zostanie usunięty/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Usuń' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Bliscy/ })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Inne/ }));
    expect(await loaded()).toBeInTheDocument();
  });
  it('guards dirty forms on cancel, Escape and native Back', async () => {
    setup();
    const form = await addContact();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.change(within(form).getByLabelText(/Imię i nazwisko/), { target: { value: 'Niezapisany' } });
    expect(allowNavigation()).toBe(false);
    fireEvent.click(within(form).getByRole('button', { name: 'Anuluj' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(form, { key: 'Escape', bubbles: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const navigation = installNativeNavigation(vi.fn());
    await navigation.ready;
    native.listeners.get('backButton')!();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    confirm.mockReturnValue(true);
    fireEvent.click(within(form).getByRole('button', { name: 'Anuluj' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    navigation.dispose();
  });
  it('preserves input after a server error and validates blank names', async () => {
    const request = setup();
    const form = await addContact();
    const input = within(form).getByLabelText(/Imię i nazwisko/);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByText('Sprawdź nazwę i długość wpisanych danych.')).toBeInTheDocument();
    fail = 'Błąd zapisu';
    fireEvent.change(input, { target: { value: 'Anna' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Zapisz' }));
    expect(await screen.findByText('Błąd zapisu')).toBeInTheDocument();
    expect(input).toHaveValue('Anna');
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
  it.each(['child', 'adult'])('handles %s permissions and missing optional fields', async (role) => {
    session.user.role = role;
    setup([{ ...base, phone: null, relationship: null, address: null }]);
    fireEvent.click(await loaded());
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText('Ciocia')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edytuj' }) !== null).toBe(role === 'adult');
    expect(screen.queryByRole('button', { name: '＋ Dodaj kontakt' }) !== null).toBe(role === 'adult');
  });
  it('blocks offline submissions even if connectivity changes after opening a form', async () => {
    const request = setup();
    const form = await addContact();
    fireEvent.change(within(form).getByLabelText(/Imię i nazwisko/), { target: { value: 'Anna' } });
    connection.offline = true;
    fireEvent.click(within(form).getByRole('button', { name: 'Zapisz' }));
    expect(await screen.findAllByText(/Połącz się z internetem, aby zapisać zmiany/)).not.toHaveLength(0);
    expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });
  it('shows an empty group, loading, fetch errors and no offline snapshot', async () => {
    setup([], true);
    expect(screen.getByText('Ładowanie kontaktów…')).toBeInTheDocument();
    expect(await screen.findByText('Nie udało się pobrać kontaktów')).toBeInTheDocument();
    cleanup();
    client.clear();
    connection.offline = true;
    setup([]);
    expect(screen.getByText(/Brak zapisanych kontaktów/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '＋ Dodaj grupę' })).toBeDisabled();
  });
});

it('normalizes Polish text without mutating the source order', () => {
  expect(matchesContact(base, 'LUCJA ZAK')).toBe(true);
  expect(matchesContact(base, '600111222')).toBe(true);
  expect(matchesContact(base, '999999')).toBe(false);
  expect(contactPhoneHref('+49 (20) 123-45')).toBe('tel:+492012345');
  const contacts = [base, { ...base, name: 'Anna' }];
  expect(sortContacts(contacts)[0]?.name).toBe('Anna');
  expect(contacts[0]?.name).toBe(base.name);
});
