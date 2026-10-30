import { StrictMode } from 'react';
import { updateTaskData } from './taskStorage.js';
import '../../offline/testSetup.js';
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { OFFLINE_REPLAY_MAX_AGE_MS, type Task, type TaskList } from '@rodzina/shared';
import { TaskPrefetch, useTaskData } from './taskQueries.js';
import { TasksPage } from './TasksPage.js';
import { TodayTasks } from './TodayTasks.js';
import { isTaskOverdue } from './taskRules.js';
import { taskStore } from './taskOffline.js';
import { reportTransportFailure } from '../../connectivity.js';
import { IDBObjectStore } from 'fake-indexeddb';

configure({ asyncUtilTimeout: 4000 });

const session = vi.hoisted(() => ({
  user: { id: '10000000-0000-4000-8000-000000000001', displayName: 'Ania', role: 'child', color: '#1C7ED6' },
  family: { id: '10000000-0000-4000-8000-000000000010', timezone: 'Europe/Warsaw' },
  familyConfirmed: true,
}));
vi.mock('../../sessionContext.js', () => ({ useMe: () => session }));
vi.mock('../family/familyQueries.js', () => ({
  useMembersQuery: () => ({
    data: [session.user, { id: '10000000-0000-4000-8000-000000000014', displayName: 'Bartek', color: '#2F9E44' }],
  }),
}));
const list: TaskList = {
  id: '10000000-0000-4000-8000-000000000011',
  familyId: '10000000-0000-4000-8000-000000000010',
  ownerId: session.user.id,
  name: 'Moje zadania',
  isDefault: true,
  memberIds: [],
  openTaskCount: 1,
  position: 0,
  createdAt: 1,
  updatedAt: 1,
};
const task: Task = {
  id: '10000000-0000-4000-8000-000000000013',
  listId: list.id,
  title: 'Kupić farbę',
  checklist: [],
  checklistOrderVersion: 0,
  notes: 'Biała',
  dueDate: '2020-01-01',
  dueTime: null,
  assigneeId: session.user.id,
  isDone: false,
  doneAt: null,
  doneBy: null,
  position: 0,
  createdBy: session.user.id,
  createdAt: 1,
  updatedAt: 1,
};
let client: QueryClient;
function setup(
  path = '/zadania/10000000-0000-4000-8000-000000000011',
  initial = [task],
  failPatch = false,
  override?: (url: string, method: string, data: Record<string, unknown>) => object | Response | undefined,
) {
  let items = [...initial];
  let lists = [
    {
      ...list,
      id: '10000000-0000-4000-8000-000000000012',
      name: 'Remont',
      isDefault: false,
      memberIds: ['10000000-0000-4000-8000-000000000014'],
    },
    list,
  ];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = String(input);
    const url = rawUrl.split('?operationId=')[0]!;
    const method = init?.method ?? 'GET';
    const data = init?.body ? JSON.parse(String(init.body)) : {};
    const custom = override?.(url, method, data);
    if (custom) return custom instanceof Response ? custom : new Response(JSON.stringify({ ok: true, ...custom }));
    if (url === '/api/auth/me') return new Response(JSON.stringify(session));
    if (failPatch && method === 'PATCH')
      return new Response(JSON.stringify({ error: { message: 'Nie udało się zapisać.' } }), { status: 400 });
    let body: object;
    if (url.startsWith('/api/reminders/mine')) body = { reminders: [] };
    else if (url === '/api/tasks/snapshot')
      body = {
        lists,
        items: Object.fromEntries(lists.map((list) => [list.id, items.filter((item) => item.listId === list.id)])),
      };
    else if (url === '/api/tasks/lists' && method === 'GET') body = { lists };
    else if (url === '/api/tasks/lists' && method === 'POST') {
      const created = { ...list, id: '10000000-0000-4000-8000-000000000015', name: data.name, isDefault: false };
      lists = [...lists, created];
      body = { list: created };
    } else if (method === 'POST') {
      const created = {
        ...task,
        ...data,
        reminders: [],
        id: new URL(rawUrl, 'https://test').searchParams.get('taskId') ?? '10000000-0000-4000-8000-000000000016',
      };
      items = [...items, created];
      body = { task: created };
    } else if (method === 'PATCH') {
      items = items.map((item) =>
        item.id === '10000000-0000-4000-8000-000000000013' ? { ...item, ...data, reminders: [] } : item,
      );
      body = { task: items[0] };
    } else if (method === 'DELETE') {
      items = items.filter((item) => url !== `/api/tasks/${item.id}`);
      body = { deleted: true };
    } else body = { tasks: url.includes('/lists/10000000-0000-4000-8000-000000000012/') ? [] : items };
    return new Response(JSON.stringify({ ok: true, ...body }));
  });
  vi.stubGlobal('fetch', fetchMock);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MantineProvider env="test">
        <MemoryRouter initialEntries={[path]}>
          <TaskPrefetch />
          <Routes>
            <Route path="/" element={<TodayTasks />} />
            <Route path="/zadania" element={<TasksPage />} />
            <Route path="/zadania/:listId" element={<TasksPage />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}
beforeEach(async () => {
  taskStore.clear(false);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  reportTransportFailure(false);
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
afterEach(async () => {
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  cleanup();
  taskStore.clear(false);
  client?.clear();
  onlineManager.setOnline(true);
  reportTransportFailure(false);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('tasks UI', () => {
  it('shows confirmed task data separately from expired changes and discards only after confirmation', async () => {
    setup();
    await screen.findByRole('article', { name: task.title });
    await act(async () => {
      onlineManager.setOnline(false);
      await taskStore.enqueue(list.id, task.id, {
        type: 'update',
        data: {
          title: 'Stary lokalny tytuł',
          notes: 'Ważna notatka',
          reminders: [{ type: 'offset', offsetValue: 15, offsetUnit: 'minute', audience: 'owner' }],
        },
      });
      await updateTaskData(`${session.family.id}:${session.user.id}`, (data) => {
        data.operations[0]!.submittedAt = Date.now() - OFFLINE_REPLAY_MAX_AGE_MS - 1000;
      });
      await taskStore.reload();
      onlineManager.setOnline(true);
      await taskStore.synchronize();
    });
    expect(screen.getByRole('article', { name: task.title })).toBeVisible();
    expect(screen.queryByRole('article', { name: 'Stary lokalny tytuł' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sprawdź zmiany' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zmiany wymagające sprawdzenia' });
    expect(within(dialog).getByText('Stary lokalny tytuł', { exact: false })).toBeVisible();
    expect(within(dialog).getByText('Ważna notatka', { exact: false })).toBeVisible();
    expect(within(dialog).getByText('15 minut przed — Osoba odpowiedzialna', { exact: false })).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Odrzuć łańcuch' }));
    expect(taskStore.getSnapshot().pending).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zamknij' }));
    expect(taskStore.getSnapshot().pending).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Sprawdź zmiany' }));
    fireEvent.click(screen.getByRole('button', { name: 'Odrzuć łańcuch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Potwierdź odrzucenie' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sprawdź zmiany' })).not.toBeInTheDocument());
    expect(taskStore.getSnapshot().pending).toHaveLength(0);
    expect(screen.getByRole('article', { name: task.title })).toBeVisible();
  });

  it('protects an unsaved quick task when switching lists', async () => {
    setup();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Dodaj zadanie' }), {
      target: { value: 'Niezapisane zadanie' },
    });
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('link', { name: 'Remont' }));
    expect(confirmation).toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Dodaj zadanie' })).toHaveValue('Niezapisane zadanie');
    confirmation.mockReturnValue(true);
    fireEvent.click(screen.getByRole('link', { name: 'Remont' }));
    expect(await screen.findByRole('heading', { name: 'Remont' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Dodaj zadanie' })).toHaveValue('');
  });
  it('returns from a directly opened list to the catalog', async () => {
    setup();
    await screen.findByRole('article', { name: task.title });
    fireEvent.click(screen.getByText(/Wróć do list/));
    expect(await screen.findByText('Wybierz listę, aby zobaczyć zadania.')).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: task.title })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Moje zadania' })).toBeInTheDocument();
  });

  it('confirms clearing only completed tasks and preserves open tasks', async () => {
    const fetchMock = setup('/zadania/10000000-0000-4000-8000-000000000011', [
      task,
      { ...task, id: '10000000-0000-4000-8000-000000000017', title: 'Gotowe 1', isDone: true },
      { ...task, id: '10000000-0000-4000-8000-000000000018', title: 'Gotowe 2', isDone: true },
    ]);
    fireEvent.click(await screen.findByRole('button', { name: 'Wyczyść zrobione' }));
    const dialog = await screen.findByRole('dialog', { name: 'Wyczyść zrobione' });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    expect(screen.getByRole('button', { name: 'Zrobione (2)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Wyczyść zrobione' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Wyczyść zrobione' })).getByRole('button', { name: 'Usuń' }),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Zrobione (0)' })).toBeInTheDocument());
    expect(screen.getByRole('article', { name: task.title })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Wyczyść zrobione' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE').map(([url]) => String(url).split('?')[0]),
      ).toEqual(['/api/tasks/10000000-0000-4000-8000-000000000017', '/api/tasks/10000000-0000-4000-8000-000000000018']),
    );
  });
  it('queues clearing completed tasks offline without sending requests', async () => {
    const fetchMock = setup('/zadania/10000000-0000-4000-8000-000000000011', [
      task,
      { ...task, id: '10000000-0000-4000-8000-000000000017', isDone: true },
      { ...task, id: '10000000-0000-4000-8000-000000000018', isDone: true },
    ]);
    await screen.findByRole('button', { name: 'Wyczyść zrobione' });
    await act(async () => {
      onlineManager.setOnline(false);
    });
    const calls = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Wyczyść zrobione' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Wyczyść zrobione' })).getByRole('button', { name: 'Usuń' }),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Zrobione (0)' })).toBeInTheDocument());
    expect(taskStore.getSnapshot().pending.map((op) => [op.taskId, op.change.type])).toEqual([
      ['10000000-0000-4000-8000-000000000017', 'remove'],
      ['10000000-0000-4000-8000-000000000018', 'remove'],
    ]);
    expect(fetchMock.mock.calls).toHaveLength(calls);
    expect(screen.getByRole('article', { name: task.title })).toBeInTheDocument();
  });
  it('shows a rejected deletion and retains the completed task for retry', async () => {
    setup('/zadania/10000000-0000-4000-8000-000000000011', [{ ...task, isDone: true }], false, (_url, method) =>
      method === 'DELETE'
        ? new Response(JSON.stringify({ error: { message: 'Nie udało się usunąć.' } }), { status: 400 })
        : undefined,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Wyczyść zrobione' }));
    const dialog = await screen.findByRole('dialog', { name: 'Wyczyść zrobione' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Usuń' }));
    expect(await within(dialog).findByText(/Nie udało się usunąć/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zrobione (1)' })).toBeInTheDocument();
  });
  it('sorts the default list first and shows member avatars only on shared lists', async () => {
    setup('/zadania');
    const navigation = await screen.findByRole('navigation', { name: 'Listy zadań' });
    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.getAttribute('aria-label')),
    ).toEqual(['Moje zadania', 'Remont']);
    expect(within(navigation).getByLabelText('Bartek')).toBeInTheDocument();
    expect(within(navigation).getAllByLabelText('Ania')).toHaveLength(1);
  });
  it('allows children to check and reopen tasks in the collapsed done section', async () => {
    const fetchMock = setup();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Zrobione: Kupić farbę' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Zrobione (1)' })).toHaveAttribute('aria-expanded', 'false'),
    );
    expect(screen.queryByRole('checkbox', { name: 'Zrobione: Kupić farbę' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zrobione (1)' }));
    const checkbox = await screen.findByRole('checkbox', { name: 'Zrobione: Kupić farbę' });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Zrobione (0)' })).toBeInTheDocument());
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/^\/api\/tasks\/10000000-0000-4000-8000-000000000013\?operationId=/),
        expect.objectContaining({ method: 'PATCH', body: '{"isDone":false}' }),
      ),
    );
  });
  it('marks an overdue deadline in red and shows the assignee', async () => {
    setup();
    const article = await screen.findByRole('article', { name: task.title });
    const deadline = within(article).getByText(/po terminie/);
    expect(deadline).toHaveStyle({ color: 'var(--mantine-color-red-9)' });
    expect(within(article).getByLabelText('Ania')).toBeInTheDocument();
  });
  it('keeps the unchecked task on a rejected write and offers the server error', async () => {
    setup('/zadania/10000000-0000-4000-8000-000000000011', [task], true);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Zrobione: Kupić farbę' }));
    expect((await screen.findAllByText(/Nie udało się zapisać/)).length).toBeGreaterThan(0);
    expect(screen.getByRole('checkbox', { name: 'Zrobione: Kupić farbę' })).not.toBeChecked();
  });
  it('quick-adds a trimmed title and keeps the form clear after success', async () => {
    const fetchMock = setup('/zadania/10000000-0000-4000-8000-000000000011', []);
    const input = await screen.findByRole('textbox', { name: 'Dodaj zadanie' });
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: '  Odebrać paczkę  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj' }));
    expect(await screen.findByRole('article', { name: 'Odebrać paczkę' })).toBeInTheDocument();
    await waitFor(() => expect(input).toHaveValue(''));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/tasks\/lists\/10000000-0000-4000-8000-000000000011\/tasks\?operationId=/),
      expect.objectContaining({ method: 'POST', body: '{"title":"Odebrać paczkę"}' }),
    );
  });
  it('opens a task URL, limits assignment to list members and clears both deadline fields without touching reminders', async () => {
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fetchMock = setup(
      '/zadania/10000000-0000-4000-8000-000000000011?zadanie=10000000-0000-4000-8000-000000000013',
      [{ ...task, dueTime: '16:45' }],
    );
    const dialog = await screen.findByRole('dialog', { name: 'Edytuj zadanie' });
    await within(dialog).findByLabelText('Notatka');
    expect(within(dialog).getByLabelText('Notatka')).toHaveValue('Biała');
    fireEvent.click(within(dialog).getByRole('textbox', { name: 'Osoba przypisana' }));
    expect(screen.getByRole('option', { name: 'Ania' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Bartek' })).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Tytuł/ }), { target: { value: 'Nowy tytuł' } });
    fireEvent.change(within(dialog).getByLabelText('Termin'), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument(), { timeout: 4000 });
    expect(confirmation).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/tasks\/10000000-0000-4000-8000-000000000013\?operationId=/),
      expect.objectContaining({
        body: JSON.stringify({
          title: 'Nowy tytuł',
          dueDate: null,
          dueTime: null,
        }),
      }),
    );
  });
  it('keeps saved private content available offline and explains disabled actions', async () => {
    setup('/zadania/10000000-0000-4000-8000-000000000011?zadanie=10000000-0000-4000-8000-000000000013');
    await screen.findByLabelText('Notatka');
    act(() => onlineManager.setOnline(false));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Notatka')).toHaveValue('Biała');
    expect(screen.getByRole('textbox', { name: 'Osoba przypisana' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dodaj przypomnienie' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dodaj listę' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ustawienia listy' })).toBeDisabled();
    expect(screen.getAllByText(/Bez internetu nie można tworzyć list/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByRole('textbox', { name: /^Tytuł/ }), { target: { value: 'Offline tytuł' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByRole('article', { name: 'Offline tytuł' })).toBeInTheDocument();
    expect(taskStore.getSnapshot().pending).toHaveLength(1);
  });
  it('lets the owner rename and share a default list but never offers deletion', async () => {
    const fetchMock = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Ustawienia listy' }));
    expect(screen.queryByRole('button', { name: 'Usuń listę' })).not.toBeInTheDocument();
    fireEvent.change(await screen.findByRole('textbox', { name: /^Nazwa listy/ }), { target: { value: 'Nowa nazwa' } });
    fireEvent.click(screen.getByRole('textbox', { name: 'Udostępnij domownikom' }));
    fireEvent.click(screen.getByRole('option', { name: 'Bartek' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/tasks/lists/10000000-0000-4000-8000-000000000011',
        expect.objectContaining({
          method: 'PATCH',
          body: '{"name":"Nowa nazwa","memberIds":["10000000-0000-4000-8000-000000000014"]}',
        }),
      ),
    );
  });
  it('offers leaving to a member without owner settings', async () => {
    const fetchMock = setup('/zadania/10000000-0000-4000-8000-000000000011', [task], false, (url, method) =>
      url === '/api/tasks/snapshot' && method === 'GET'
        ? {
            lists: [{ ...list, ownerId: '10000000-0000-4000-8000-000000000014', memberIds: [session.user.id] }],
            items: { [list.id]: [task] },
          }
        : undefined,
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Opuść listę' }));
    expect(screen.queryByRole('button', { name: 'Ustawienia listy' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/tasks/lists/10000000-0000-4000-8000-000000000011/leave',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });
  it('hides an open task when the next list poll reports revoked access', async () => {
    let revoked = false;
    setup(
      '/zadania/10000000-0000-4000-8000-000000000011?zadanie=10000000-0000-4000-8000-000000000013',
      [task],
      false,
      (url, method) =>
        revoked && url === '/api/tasks/snapshot' && method === 'GET' ? { lists: [], items: {} } : undefined,
    );
    await screen.findByLabelText('Notatka');
    revoked = true;
    await act(async () => {
      await taskStore.synchronize();
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText(task.title)).not.toBeInTheDocument();
    expect(await screen.findByText('Lista jest niedostępna lub nie masz do niej dostępu.')).toBeInTheDocument();
  });
  it('uses task presets and limits the audience on a private list', async () => {
    const fetchMock = setup(
      '/zadania/10000000-0000-4000-8000-000000000011?zadanie=10000000-0000-4000-8000-000000000013',
    );
    fireEvent.click(await screen.findByRole('textbox', { name: 'Kiedy przypomnieć' }));
    expect(screen.getByRole('option', { name: 'W dniu terminu' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '15 minut przed' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'W dniu terminu' }));
    fireEvent.click(screen.getByRole('textbox', { name: 'Odbiorcy' }));
    expect(screen.queryByRole('option', { name: 'Wszyscy na liście' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Cała rodzina' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Osoba przypisana lub właściciel listy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj przypomnienie' }));
    await screen.findByText(/W dniu terminu · Osoba/);
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/^\/api\/tasks\/10000000-0000-4000-8000-000000000013\?operationId=/),
        expect.objectContaining({
          body: expect.stringContaining(
            '"reminders":[{"type":"offset","offsetValue":0,"offsetUnit":"minute","audience":"owner"}]',
          ),
        }),
      ),
    );
  });
  it('retries personal reminders after a partial failure without creating the task twice', async () => {
    let attempts = 0;
    const fetchMock = setup('/zadania/10000000-0000-4000-8000-000000000011', [], false, (url, method) => {
      if (url === '/api/reminders/mine' && method === 'POST') {
        attempts++;
        return attempts === 1
          ? new Response(JSON.stringify({ error: { message: 'Spróbuj ponownie.' } }), { status: 500 })
          : { reminder: { id: 'personal' } };
      }
      return undefined;
    });
    const add = await screen.findByRole('button', { name: 'Dodaj zadanie ze szczegółami' });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    fireEvent.change(await screen.findByRole('textbox', { name: /^Tytuł/ }), { target: { value: 'Nowe zadanie' } });
    fireEvent.change(screen.getByLabelText('Termin'), { target: { value: '2030-01-01' } });
    fireEvent.click(screen.getByRole('textbox', { name: 'Odbiorcy' }));
    fireEvent.click(screen.getByRole('option', { name: 'Tylko ja' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj przypomnienie' }));
    await screen.findByText(/W dniu terminu · Tylko ja/);
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await screen.findByText(/Zadanie zapisano, ale nie wszystkie/, {}, { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).startsWith('/api/tasks/lists/10000000-0000-4000-8000-000000000011/tasks?') &&
          init?.method === 'POST',
      ),
    ).toHaveLength(1);
    expect(attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/reminders/mine',
      expect.objectContaining({
        body: expect.stringContaining('"type":"offset","offsetValue":0,"offsetUnit":"minute"'),
      }),
    );
  }, 15000);
  it('does not request private data before confirming the account', () => {
    session.familyConfirmed = false;
    const fetchMock = setup();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Wczytywanie zadań…')).toBeInTheDocument();
  });
  it('hides cached details when a later access check is rejected', async () => {
    const fetchMock = setup(
      '/zadania/10000000-0000-4000-8000-000000000011?zadanie=10000000-0000-4000-8000-000000000013',
    );
    await screen.findByRole('dialog');
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ error: { message: 'Nie znaleziono listy.' } }), { status: 404 }),
    );
    await act(async () => {
      await taskStore.synchronize();
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText(task.title)).not.toBeInTheDocument();
    expect(await screen.findByText('Nie znaleziono listy.')).toBeInTheDocument();
  });
});

const checklistTask: Task = {
  ...task,
  checklistOrderVersion: 0,
  checklist: ['Okna', 'Podłoga'].map((title, position) => ({
    id: `10000000-0000-4000-8000-00000000002${position}`,
    taskId: task.id,
    title,
    position,
    isDone: false,
    doneBy: null,
    doneAt: null,
    version: 0,
    doneVersion: 0,
    createdBy: session.user.id,
    createdAt: 1,
    updatedAt: 1,
  })),
};
const taskPath = `/zadania/${list.id}?zadanie=${task.id}`;
async function openOfflineChecklist(initial = checklistTask) {
  setup(taskPath, [structuredClone(initial)]);
  await screen.findByRole('region', { name: 'Podzadania' });
  act(() => onlineManager.setOnline(false));
  return within(screen.getByRole('region', { name: 'Podzadania' }));
}

describe('task checklist UI', () => {
  it('lets a child add, edit, reorder, check and remove offline without changing parent counts', async () => {
    const section = await openOfflineChecklist();
    const draft = section.getByRole('textbox', { name: 'Nowe podzadanie' });
    fireEvent.change(draft, { target: { value: '  Drzwi  ' } });
    fireEvent.keyDown(draft, { key: 'Enter' });
    await section.findByRole('checkbox', { name: 'Drzwi' });
    await waitFor(() => expect(draft).toHaveValue(''));
    fireEvent.click(section.getByRole('button', { name: 'Edytuj podzadanie: Drzwi' }));
    fireEvent.change(section.getByRole('textbox', { name: 'Nazwa podzadania' }), { target: { value: 'Lustra' } });
    fireEvent.click(section.getByRole('button', { name: 'Zapisz podzadanie' }));
    await section.findByRole('checkbox', { name: 'Lustra' });
    await waitFor(() => expect(section.getByRole('button', { name: 'Przenieś wyżej: Lustra' })).toBeEnabled());
    fireEvent.click(section.getByRole('button', { name: 'Przenieś wyżej: Lustra' }));
    await waitFor(() =>
      expect(taskStore.project().items[list.id]![0]!.checklist?.map((item) => item.title)).toEqual([
        'Okna',
        'Lustra',
        'Podłoga',
      ]),
    );
    await waitFor(() => expect(section.getByRole('checkbox', { name: 'Lustra' })).toBeEnabled());
    fireEvent.click(section.getByRole('checkbox', { name: 'Lustra' }));
    await section.findByText('Podzadania: 1 z 3');
    expect(screen.getByRole('checkbox', { name: 'Zrobione: Kupić farbę' })).not.toBeChecked();
    expect(taskStore.project().lists?.find((item) => item.id === list.id)?.openTaskCount).toBe(1);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await waitFor(() => expect(section.getByRole('button', { name: 'Usuń podzadanie: Lustra' })).toBeEnabled());
    fireEvent.click(section.getByRole('button', { name: 'Usuń podzadanie: Lustra' }));
    await waitFor(() => expect(section.queryByRole('checkbox', { name: 'Lustra' })).not.toBeInTheDocument());
    expect(section.getByText('Podzadania: 0 z 2')).toBeVisible();
    expect(screen.getAllByText(/Zmiany oczekujące na wysłanie:/).length).toBeGreaterThan(0);
  }, 15000);

  it('warns before completing unfinished steps, accepts cancellation and preserves steps when reopening', async () => {
    await openOfflineChecklist();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Ukończ zadanie' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('niewykonane podzadania: 2'));
    expect(screen.getByRole('checkbox', { name: 'Zrobione: Kupić farbę' })).not.toBeChecked();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Ukończ zadanie' }));
    await screen.findByRole('button', { name: 'Oznacz zadanie jako niewykonane' });
    fireEvent.click(screen.getByRole('button', { name: 'Oznacz zadanie jako niewykonane' }));
    await screen.findByRole('button', { name: 'Ukończ zadanie' });
    expect(taskStore.project().items[list.id]![0]!.checklist).toEqual(checklistTask.checklist);
  });

  it('keeps the parent open after the last step and completes it only on explicit action', async () => {
    const initial = structuredClone(checklistTask);
    initial.checklist![0]!.isDone = true;
    const section = await openOfflineChecklist(initial);
    fireEvent.click(section.getByRole('checkbox', { name: 'Podłoga' }));
    await section.findByText('Podzadania: 2 z 2');
    expect(taskStore.project().items[list.id]![0]!.isDone).toBe(false);
    const confirm = vi.spyOn(window, 'confirm');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ukończ zadanie' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Ukończ zadanie' }));
    await screen.findByRole('button', { name: 'Oznacz zadanie jako niewykonane' });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('explains an unknown checklist and warns on completion from the list', async () => {
    const initial = { ...task, checklist: undefined, checklistOrderVersion: undefined };
    const section = await openOfflineChecklist(initial);
    expect(section.getByText(/pobrać pełną checklistę/)).toBeVisible();
    expect(section.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Zrobione: Kupić farbę' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Nie znamy pełnej checklisty'));
    expect(screen.getByRole('checkbox', { name: 'Zrobione: Kupić farbę' })).not.toBeChecked();
  });

  it('keeps the draft and confirmed checklist on durable storage failure', async () => {
    const section = await openOfflineChecklist();
    const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new Error('Brak miejsca na urządzeniu');
    });
    fireEvent.change(section.getByRole('textbox', { name: 'Nowe podzadanie' }), { target: { value: 'Nie zapisano' } });
    fireEvent.click(section.getByRole('button', { name: 'Dodaj podzadanie' }));
    await section.findByText(/Brak miejsca na urządzeniu/);
    expect(section.getByRole('textbox', { name: 'Nowe podzadanie' })).toHaveValue('Nie zapisano');
    expect(section.queryByRole('checkbox', { name: 'Nie zapisano' })).not.toBeInTheDocument();
    failure.mockRestore();
  });

  it('protects unsaved parent fields after a checklist save and protects checklist drafts on close', async () => {
    const section = await openOfflineChecklist();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.change(screen.getByLabelText('Notatka'), { target: { value: 'Nie zapisano notatki' } });
    fireEvent.click(section.getByRole('checkbox', { name: 'Okna' }));
    await section.findByText('Podzadania: 1 z 2');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Anuluj' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.change(section.getByRole('textbox', { name: 'Nowe podzadanie' }), { target: { value: 'Szkic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj' }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(section.getByRole('textbox', { name: 'Nowe podzadanie' })).toHaveValue('Szkic');
  });

  it('shows rejected checklist changes for review without applying them to confirmed data', async () => {
    setup(taskPath, [checklistTask], false, (url, method) =>
      url.includes('/checklist') && method === 'POST'
        ? new Response(JSON.stringify({ error: { code: 'OPERATION_CONFLICT', message: 'Konflikt podzadania' } }), {
            status: 409,
          })
        : undefined,
    );
    const section = within(await screen.findByRole('region', { name: 'Podzadania' }));
    fireEvent.change(section.getByRole('textbox', { name: 'Nowe podzadanie' }), {
      target: { value: 'Sprzeczny krok' },
    });
    fireEvent.click(section.getByRole('button', { name: 'Dodaj podzadanie' }));
    await screen.findByText(/Zamknij formularz i wybierz/);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Anuluj' })).toBeEnabled());
    expect(section.queryByRole('checkbox', { name: 'Sprzeczny krok' })).not.toBeInTheDocument();
    expect(section.getByRole('textbox', { name: 'Nowe podzadanie' })).toHaveValue('Sprzeczny krok');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Sprawdź zmiany' }));
    expect(await screen.findByText('1. Dodanie podzadania')).toBeVisible();
    expect(screen.getByText('Sprzeczny krok', { exact: false })).toBeVisible();
  }, 15000);
});

describe('today tasks card', () => {
  it('shows checklist progress without counting its steps as tasks', async () => {
    const initial = structuredClone(checklistTask);
    initial.checklist![0]!.isDone = true;
    setup('/', [initial]);
    expect(await screen.findByText('Podzadania: 1 z 2')).toBeVisible();
    expect(screen.getAllByRole('link', { name: task.title })).toHaveLength(1);
  });
  it('recomputes today after midnight offline in the family timezone', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-20T21:59:30Z'));
    setup('/', [{ ...task, dueDate: '2026-10-21' }]);
    await vi.waitFor(() => expect(screen.getByText('Na dziś wszystko zrobione.')).toBeInTheDocument());
    act(() => onlineManager.setOnline(false));
    cleanup();
    client.clear();
    setup('/');
    expect(screen.getByText('Na dziś wszystko zrobione.')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByRole('link', { name: task.title })).toBeInTheDocument();
  });
  it('links visible due tasks and keeps them available offline', async () => {
    setup('/');
    const link = await screen.findByRole('link', { name: task.title });
    expect(link).toHaveAttribute(
      'href',
      '/zadania/10000000-0000-4000-8000-000000000011?zadanie=10000000-0000-4000-8000-000000000013',
    );
    expect(screen.getByText(/po terminie/)).toBeInTheDocument();
    act(() => onlineManager.setOnline(false));
    expect(screen.getByRole('link', { name: task.title })).toBeInTheDocument();
    expect(screen.getByText('Pokazujemy zapisane zadania i oczekujące zmiany.')).toBeInTheDocument();
  });
  it('replaces removed tasks with the empty state on refresh', async () => {
    let removed = false;
    setup('/', [task], false, (url) =>
      url === '/api/tasks/snapshot' ? { lists: [list], items: { [list.id]: removed ? [] : [task] } } : undefined,
    );
    await screen.findByText(task.title);
    removed = true;
    await act(async () => {
      await taskStore.synchronize();
    });
    expect(await screen.findByText('Na dziś wszystko zrobione.')).toBeInTheDocument();
    expect(screen.queryByText(task.title)).not.toBeInTheDocument();
  });
});

it('evaluates date-only and timed deadlines in the family timezone, excluding completed and undated tasks', () => {
  const now = Date.parse('2026-10-20T00:30:00Z');
  expect(isTaskOverdue({ ...task, dueDate: '2026-10-19' }, 'Europe/Warsaw', now)).toBe(true);
  expect(isTaskOverdue({ ...task, dueDate: '2026-10-20' }, 'Europe/Warsaw', now)).toBe(false);
  expect(isTaskOverdue({ ...task, dueDate: '2026-10-20', dueTime: '02:00' }, 'Europe/Warsaw', now)).toBe(true);
  expect(isTaskOverdue({ ...task, dueDate: '2026-10-20', dueTime: '03:00' }, 'Europe/Warsaw', now)).toBe(false);
  expect(isTaskOverdue({ ...task, dueDate: '2026-10-19' }, 'America/Los_Angeles', now)).toBe(false);
  expect(isTaskOverdue({ ...task, isDone: true }, 'Europe/Warsaw', now)).toBe(false);
  expect(isTaskOverdue({ ...task, dueDate: null }, 'Europe/Warsaw', now)).toBe(false);
});

it('registers one task poller for multiple readers and cleans it on account changes in Strict Mode', async () => {
  onlineManager.setOnline(false);
  const set = vi.spyOn(window, 'setInterval');
  const clear = vi.spyOn(window, 'clearInterval');
  const active = () =>
    set.mock.results.filter(
      (result, i) =>
        result.type === 'return' &&
        set.mock.calls[i]?.[1] === 20000 &&
        !clear.mock.calls.some(([id]) => id === result.value),
    );
  const Reader = () => {
    useTaskData();
    return null;
  };
  client = new QueryClient();
  const element = () => (
    <StrictMode>
      <QueryClientProvider client={client}>
        <TaskPrefetch />
        <Reader />
        <Reader />
      </QueryClientProvider>
    </StrictMode>
  );
  const previous = session.user.id;
  const view = render(element());
  try {
    await waitFor(() => expect(active()).toHaveLength(1));
    session.user.id = '10000000-0000-4000-8000-000000000099';
    view.rerender(element());
    expect(active()).toHaveLength(1);
    view.unmount();
    expect(active()).toHaveLength(0);
  } finally {
    session.user.id = previous;
    view.unmount();
    set.mockRestore();
    clear.mockRestore();
  }
});
