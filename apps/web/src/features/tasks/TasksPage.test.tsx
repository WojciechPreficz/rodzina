import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { Task, TaskList } from '@rodzina/shared';
import { TasksPage } from './TasksPage.js';
import { TodayTasks } from './TodayTasks.js';
import { isTaskOverdue } from './taskRules.js';
import { taskStore } from './taskOffline.js';
import { reportTransportFailure } from '../../connectivity.js';

const session = vi.hoisted(() => ({
  user: { id: '10000000-0000-4000-8000-000000000001', displayName: 'Ania', role: 'child', color: '#1C7ED6' },
  family: { id: 'family', timezone: 'Europe/Warsaw' },
  familyConfirmed: true,
}));
vi.mock('../../auth.js', () => ({ useMe: () => session }));
vi.mock('../family/familyQueries.js', () => ({
  useMembersQuery: () => ({ data: [session.user, { id: 'other', displayName: 'Bartek', color: '#2F9E44' }] }),
}));
const list: TaskList = {
  id: 'list',
  familyId: 'family',
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
  id: 'task',
  listId: list.id,
  title: 'Kupić farbę',
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
  path = '/zadania/list',
  initial = [task],
  failPatch = false,
  override?: (url: string, method: string, data: Record<string, unknown>) => object | Response | undefined,
) {
  let items = [...initial];
  let lists = [{ ...list, id: 'second', name: 'Remont', isDefault: false, memberIds: ['other'] }, list];
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
    else if (url === '/api/tasks/lists' && method === 'GET') body = { lists };
    else if (url === '/api/tasks/lists' && method === 'POST') {
      const created = { ...list, id: 'new-list', name: data.name, isDefault: false };
      lists = [...lists, created];
      body = { list: created };
    } else if (method === 'POST') {
      const created = {
        ...task,
        ...data,
        id: new URL(rawUrl, 'https://test').searchParams.get('taskId') ?? 'new-task',
      };
      items = [...items, created];
      body = { task: created };
    } else if (method === 'PATCH') {
      items = items.map((item) => (item.id === 'task' ? { ...item, ...data } : item));
      body = { task: items[0] };
    } else if (method === 'DELETE') {
      items = [];
      body = { deleted: true };
    } else body = { tasks: url.includes('/lists/second/') ? [] : items };
    return new Response(JSON.stringify({ ok: true, ...body }));
  });
  vi.stubGlobal('fetch', fetchMock);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MantineProvider env="test">
        <MemoryRouter initialEntries={[path]}>
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
beforeEach(() => {
  taskStore.clear();
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
afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  cleanup();
  taskStore.clear();
  client?.clear();
  onlineManager.setOnline(true);
  reportTransportFailure(false);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('tasks UI', () => {
  it('sorts the default list first and shows member avatars only on shared lists', async () => {
    setup('/zadania');
    const navigation = await screen.findByRole('navigation', { name: 'Listy zadań' });
    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.textContent),
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
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/tasks\/task\?operationId=/),
      expect.objectContaining({ method: 'PATCH', body: '{"isDone":false}' }),
    );
  });
  it('marks an overdue deadline in red and shows the assignee', async () => {
    setup();
    const article = await screen.findByRole('article', { name: task.title });
    const deadline = within(article).getByText(/po terminie/);
    expect(deadline).toHaveStyle({ color: 'var(--mantine-color-red-text)' });
    expect(within(article).getByLabelText('Ania')).toBeInTheDocument();
  });
  it('keeps the unchecked task on a rejected write and offers the server error', async () => {
    setup('/zadania/list', [task], true);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Zrobione: Kupić farbę' }));
    expect((await screen.findAllByText(/Nie udało się zapisać/)).length).toBeGreaterThan(0);
    expect(screen.getByRole('checkbox', { name: 'Zrobione: Kupić farbę' })).not.toBeChecked();
  });
  it('quick-adds a trimmed title and keeps the form clear after success', async () => {
    const fetchMock = setup('/zadania/list', []);
    const input = await screen.findByRole('textbox', { name: 'Dodaj zadanie' });
    fireEvent.change(input, { target: { value: '  Odebrać paczkę  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj' }));
    expect(await screen.findByRole('article', { name: 'Odebrać paczkę' })).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/tasks\/lists\/list\/tasks\?operationId=/),
      expect.objectContaining({ method: 'POST', body: '{"title":"Odebrać paczkę"}' }),
    );
  });
  it('opens a task URL, limits assignment to list members and clears both deadline fields without touching reminders', async () => {
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fetchMock = setup('/zadania/list?zadanie=task', [{ ...task, dueTime: '16:45' }]);
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
      expect.stringMatching(/^\/api\/tasks\/task\?operationId=/),
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
    setup('/zadania/list?zadanie=task');
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
        '/api/tasks/lists/list',
        expect.objectContaining({ method: 'PATCH', body: '{"name":"Nowa nazwa","memberIds":["other"]}' }),
      ),
    );
  });
  it('offers leaving to a member without owner settings', async () => {
    const fetchMock = setup('/zadania/list', [task], false, (url, method) =>
      url === '/api/tasks/lists' && method === 'GET'
        ? { lists: [{ ...list, ownerId: 'other', memberIds: [session.user.id] }] }
        : undefined,
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Opuść listę' }));
    expect(screen.queryByRole('button', { name: 'Ustawienia listy' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/tasks/lists/list/leave',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
  });
  it('hides an open task when the next list poll reports revoked access', async () => {
    let revoked = false;
    setup('/zadania/list?zadanie=task', [task], false, (url, method) =>
      revoked && url === '/api/tasks/lists' && method === 'GET' ? { lists: [] } : undefined,
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
    const fetchMock = setup('/zadania/list?zadanie=task');
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
        expect.stringMatching(/^\/api\/tasks\/task\?operationId=/),
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
    const fetchMock = setup('/zadania/list', [], false, (url, method) => {
      if (url === '/api/reminders/mine' && method === 'POST') {
        attempts++;
        return attempts === 1
          ? new Response(JSON.stringify({ error: { message: 'Spróbuj ponownie.' } }), { status: 500 })
          : { reminder: { id: 'personal' } };
      }
      return undefined;
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Dodaj zadanie ze szczegółami' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /^Tytuł/ }), { target: { value: 'Nowe zadanie' } });
    fireEvent.change(screen.getByLabelText('Termin'), { target: { value: '2030-01-01' } });
    fireEvent.click(screen.getByRole('textbox', { name: 'Odbiorcy' }));
    fireEvent.click(screen.getByRole('option', { name: 'Tylko ja' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj przypomnienie' }));
    await screen.findByText(/W dniu terminu · Tylko ja/);
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await screen.findByText(/Zadanie zapisano, ale nie wszystkie/);
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) => String(url).startsWith('/api/tasks/lists/list/tasks?') && init?.method === 'POST',
      ),
    ).toHaveLength(1);
    expect(attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/reminders/mine',
      expect.objectContaining({
        body: expect.stringContaining('"type":"offset","offsetValue":0,"offsetUnit":"minute"'),
      }),
    );
  });
  it('does not request private data before confirming the account', () => {
    session.familyConfirmed = false;
    const fetchMock = setup();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Wczytywanie zadań…')).toBeInTheDocument();
  });
  it('hides cached details when a later access check is rejected', async () => {
    const fetchMock = setup('/zadania/list?zadanie=task');
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

describe('today tasks card', () => {
  it('recomputes today after midnight offline in the family timezone', async () => {
    setup('/', [{ ...task, dueDate: '2026-10-21' }]);
    await screen.findByText('Na dziś wszystko zrobione.');
    act(() => onlineManager.setOnline(false));
    cleanup();
    client.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T21:59:30Z'));
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
    expect(link).toHaveAttribute('href', '/zadania/list?zadanie=task');
    expect(screen.getByText(/po terminie/)).toBeInTheDocument();
    act(() => onlineManager.setOnline(false));
    expect(screen.getByRole('link', { name: task.title })).toBeInTheDocument();
    expect(screen.getByText('Pokazujemy zapisane zadania i oczekujące zmiany.')).toBeInTheDocument();
  });
  it('replaces removed tasks with the empty state on refresh', async () => {
    let removed = false;
    setup('/', [task], false, (url) =>
      url.includes('/tasks?status=all') ? { tasks: removed ? [] : [task] } : undefined,
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
