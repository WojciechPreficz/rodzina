import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { Task, TaskSeries } from '@rodzina/shared';
import { TaskRecurrenceEditor } from './TaskRecurrenceEditor.js';

const mocks = vi.hoisted(() => ({ api: vi.fn(), sync: vi.fn(), schedule: vi.fn() }));
vi.mock('../../api.js', () => ({ apiFetch: mocks.api }));
vi.mock('../../connectivity.js', () => ({ isOffline: () => false }));
vi.mock('../../sessionContext.js', () => ({
  useMe: () => ({
    user: { id: '10000000-0000-4000-8000-000000000001' },
    family: { id: '10000000-0000-4000-8000-000000000002' },
  }),
}));
vi.mock('./taskOffline.js', () => ({ taskStore: { synchronize: mocks.sync } }));
vi.mock('../notifications/scheduleSync.js', () => ({ refreshLocalSchedule: mocks.schedule }));
const task = {
  id: '10000000-0000-4000-8000-000000000003',
  title: 'Kwiaty',
  isDone: false,
  recurrence: null,
  checklist: [],
  dueDate: '2026-03-03',
  dueTime: null,
} as unknown as Task;
const template = { title: 'Kwiaty', notes: null, assigneeId: null, reminders: [] };
const series: TaskSeries = {
  id: '10000000-0000-4000-8000-000000000004',
  listId: '10000000-0000-4000-8000-000000000005',
  rule: {
    mode: 'schedule',
    unit: 'week',
    interval: 1,
    startDate: '2026-03-03',
    time: null,
    timezone: 'Europe/Warsaw',
    endDate: null,
    weekdays: [2],
  },
  template: { ...template, checklist: ['Podlej'] },
  state: 'active',
  version: 2,
  createdBy: null,
  createdAt: 1,
  updatedAt: 1,
};
const recurring = {
  ...task,
  recurrence: {
    seriesId: series.id,
    seriesVersion: 2,
    sequence: 0,
    version: 3,
    plannedDate: '2026-03-03',
    plannedTime: null,
    state: 'active',
    closedAt: null,
    closedBy: null,
  },
} as Task;
let client: QueryClient;
function setup(value = task, disabled = false) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const saved = vi.fn();
  render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <TaskRecurrenceEditor
          task={value}
          template={template}
          disabled={disabled}
          prepare={vi.fn()}
          onSaved={saved}
          onBusy={vi.fn()}
        />
      </QueryClientProvider>
    </MantineProvider>,
  );
  return saved;
}
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  mocks.api.mockReset();
  mocks.sync.mockReset();
  mocks.schedule.mockReset();
  mocks.api.mockImplementation(async (path: string) =>
    path.endsWith('/history')
      ? { ok: true, history: [] }
      : { ok: true, series, activeTaskId: task.id, occurrenceVersion: 3 },
  );
});
afterEach(() => {
  cleanup();
  client?.clear();
  vi.unstubAllGlobals();
});
async function select(label: string, option: string) {
  fireEvent.click(screen.getByRole('textbox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}
it.each(['Według kalendarza', 'Po wykonaniu lub pominięciu'])(
  'configures %s and validates the date boundary',
  async (mode) => {
    const saved = setup();
    await select('Powtarzanie', mode);
    fireEvent.change(screen.getByLabelText('Koniec serii (włącznie, opcjonalnie)'), {
      target: { value: '2026-01-01' },
    });
    expect(screen.getByRole('button', { name: 'Utwórz serię' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Koniec serii (włącznie, opcjonalnie)'), { target: { value: '' } });
    if (mode === 'Według kalendarza') fireEvent.click(screen.getByLabelText('Pt'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Termin wystąpienia:'));
    fireEvent.click(screen.getByRole('button', { name: 'Utwórz serię' }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    const input = JSON.parse(mocks.api.mock.calls[0]![1].body);
    expect(input.rule.mode).toBe(mode === 'Według kalendarza' ? 'schedule' : 'after_completion');
    expect(input.template.checklist).toEqual([]);
    expect(input.expectedOccurrenceVersion).toBe(0);
  },
);
it('shows the template and history and requires an explicit choice to replace future steps', async () => {
  const saved = setup(recurring);
  const button = await screen.findByRole('button', { name: 'Zapisz to i kolejne' });
  expect(screen.getByLabelText('Użyj bieżącej checklisty jako wzorca kolejnych zadań')).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Historia serii' }));
  expect(await screen.findByText('Brak zamkniętych wystąpień.')).toBeVisible();
  fireEvent.click(button);
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const call = mocks.api.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
  expect(JSON.parse(call[1].body)).toMatchObject({
    expectedVersion: 2,
    expectedOccurrenceVersion: 3,
    template: { checklist: ['Podlej'] },
  });
});
it('shows conflicts, keeps the form, and retries the same operation after a lost response', async () => {
  const saved = setup(recurring);
  const button = await screen.findByRole('button', { name: 'Zapisz to i kolejne' });
  mocks.api.mockRejectedValueOnce(new Error('Konflikt serii'));
  fireEvent.click(button);
  expect(await screen.findByText(/Konflikt serii/)).toBeVisible();
  expect(saved).not.toHaveBeenCalled();
  const first = mocks.api.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
  fireEvent.click(button);
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const writes = mocks.api.mock.calls.filter(([, init]) => init?.method === 'PATCH');
  expect(writes[1]![0]).toBe(first[0]);
  expect(writes[1]![1].body).toBe(first[1].body);
});
it('blocks unknown cached data and configuration offline without fetching history', () => {
  setup({ ...task, recurrence: undefined }, true);
  expect(screen.getByRole('textbox', { name: 'Powtarzanie' })).toBeDisabled();
  expect(screen.getByText(/Wykonanie pobranego zadania działa offline/)).toBeVisible();
  expect(screen.getByText(/Brak danych o cykliczności/)).toBeVisible();
  expect(mocks.api).not.toHaveBeenCalled();
});
