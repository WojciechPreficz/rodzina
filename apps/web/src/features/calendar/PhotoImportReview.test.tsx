import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseOcrEvents, type OcrParseResult } from '@rodzina/shared';
import { PhotoImportReview } from './PhotoImportReview.js';
import { clearAccountData } from '../../accountStorage.js';
import type { PhotoImportOperation } from './photoImportStorage.js';

const { api, read, write, refresh, stale, session, network } = vi.hoisted(() => ({
  api: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  refresh: vi.fn(),
  stale: vi.fn(),
  session: { generation: 0 },
  network: { offline: false },
}));
vi.mock('../../api.js', () => ({ apiFetch: api }));
vi.mock('../../platform.js', () => ({ getSessionGeneration: () => session.generation }));
vi.mock('../../connectivity.js', () => ({ isOffline: () => network.offline, useOffline: () => network.offline }));
vi.mock('./calendarQueries.js', () => ({ useCalendarReadOnly: () => network.offline }));
vi.mock('./calendarOffline.js', () => ({ calendarStore: { markStale: stale } }));
vi.mock('../../reminders/scheduleSync.js', () => ({ refreshLocalSchedule: refresh }));
vi.mock('./photoImportStorage.js', () => ({ readPhotoImports: read, writePhotoImports: write }));

const result = parseOcrEvents({
  image: { width: 1000, height: 1000 },
  lines: [
    { id: '1', text: 'Koncert rodzinny', box: { x: 0.1, y: 0.1, width: 0.6, height: 0.04 } },
    { id: '2', text: '12 listopada', box: { x: 0.1, y: 0.2, width: 0.6, height: 0.04 } },
  ],
});
let stored: PhotoImportOperation[];
let client: QueryClient;
function review(proposals: OcrParseResult | null = result) {
  return (
    <QueryClientProvider client={client}>
      <MantineProvider env="test">
        <PhotoImportReview
          members={[]}
          timezone="Europe/Warsaw"
          initialDate="2026-11-01"
          result={proposals ?? undefined}
          renderSource={(proposal) => <p>{proposal.title}</p>}
        />
      </MantineProvider>
    </QueryClientProvider>
  );
}
function show(proposals: OcrParseResult | null = result) {
  return render(review(proposals));
}
async function approve(title?: string) {
  fireEvent.click(
    await screen.findByRole('button', { name: title ? 'Dodaj ręcznie propozycję' : 'Popraw i zatwierdź' }),
  );
  const dialog = within(await screen.findByRole('dialog'));
  if (title) fireEvent.change(dialog.getByLabelText(/^Tytuł/), { target: { value: title } });
  fireEvent.change(dialog.getByLabelText(/^Data/), { target: { value: '2026-11-12' } });
  fireEvent.click(dialog.getByRole('switch', { name: 'Bez godziny' }));
  fireEvent.click(dialog.getByRole('button', { name: 'Zatwierdź do paczki' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('checkbox', { name: `Wybierz do zapisu: ${title ?? 'Koncert rodzinny'}` }));
}
beforeEach(() => {
  vi.clearAllMocks();
  stored = [];
  session.generation = 0;
  network.offline = false;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  read.mockImplementation(async () =>
    structuredClone(stored.filter((entry) => !entry.result || entry.result.status === 'error')),
  );
  write.mockImplementation(async (updates: PhotoImportOperation[], remove: string[] = []) => {
    const merged = new Map(
      stored.filter((entry) => !remove.includes(entry.operationId)).map((entry) => [entry.operationId, entry]),
    );
    updates.forEach((entry) => merged.set(entry.operationId, structuredClone(entry)));
    stored = [...merged.values()];
  });
  api.mockImplementation(async (_url: string, init: RequestInit) => {
    const { items } = JSON.parse(init.body as string) as { items: PhotoImportOperation[] };
    expect(stored.map((entry) => entry.operationId)).toEqual(
      expect.arrayContaining(items.map((entry) => entry.operationId)),
    );
    return {
      ok: true,
      results: items.map((entry) => ({
        operationId: entry.operationId,
        status: 'created',
        eventId: crypto.randomUUID(),
      })),
    };
  });
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('photo import review', () => {
  it('clears previous photo proposals as soon as another photo starts, retaining unfinished sent operations', async () => {
    stored = [
      {
        operationId: crypto.randomUUID(),
        event: {
          title: 'Do ponowienia',
          startDate: '2026-11-12',
          startTime: null,
          durationMinutes: null,
          description: null,
          location: null,
          participantIds: [],
          kind: 'single',
          datePrecision: 'day',
          rrule: null,
        },
      },
    ];
    const view = show();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Popraw i zatwierdź' })).toBeEnabled());
    await approve();
    expect(screen.getByRole('checkbox', { name: 'Wybierz do zapisu: Koncert rodzinny' })).toBeChecked();
    view.rerender(review(null));
    expect(screen.queryByRole('checkbox', { name: 'Wybierz do zapisu: Koncert rodzinny' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Wybierz do zapisu: Do ponowienia' })).toBeDisabled();
    const next = {
      ...result,
      proposals: result.proposals.map((proposal) => ({ ...proposal, title: 'Drugie zdjęcie' })),
    };
    view.rerender(review(next));
    expect(await screen.findByRole('checkbox', { name: 'Wybierz do zapisu: Drugie zdjęcie' })).not.toBeChecked();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Zapisz wybrane (0/20)' })).toBeDisabled();
  });
  it.each(['replace', 'add'] as const)(
    'asks about a duplicate and persists the %s decision before sending a new operation',
    async (action) => {
      show();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Popraw i zatwierdź' })).toBeEnabled());
      await approve();
      const eventId = crypto.randomUUID();
      api.mockImplementationOnce(async (_url, init) => {
        const operationId = JSON.parse(init.body).items[0].operationId;
        return {
          ok: true,
          results: [
            {
              operationId,
              status: 'error',
              error: {
                code: 'DUPLICATE_EVENT',
                message: 'Takie wydarzenie już istnieje',
                duplicates: [
                  {
                    eventId,
                    title: 'Koncert rodzinny',
                    startDate: '2026-11-12',
                    startTime: null,
                    kind: 'single',
                    canReplace: true,
                    version: 'a'.repeat(64),
                  },
                ],
              },
            },
          ],
        };
      });
      fireEvent.click(screen.getByRole('button', { name: 'Zapisz wybrane (1/20)' }));
      const dialog = within(await screen.findByRole('dialog', { name: 'Takie wydarzenie już istnieje' }));
      const original = JSON.parse(api.mock.calls[0]![1].body).items[0];
      expect(original.duplicateResolution).toEqual({ action: 'check' });
      fireEvent.click(
        dialog.getByRole('button', { name: action === 'replace' ? 'Zastąp istniejące' : 'Dodaj kolejne' }),
      );
      expect(
        await screen.findByText(action === 'replace' ? 'Zastąpiono istniejące wydarzenie.' : 'Zapisano w kalendarzu.'),
      ).toBeInTheDocument();
      const chosen = JSON.parse(api.mock.calls[1]![1].body).items[0];
      expect(chosen.operationId).not.toBe(original.operationId);
      expect(chosen.duplicateResolution).toEqual(
        action === 'add' ? { action } : { action, eventId, version: 'a'.repeat(64) },
      );
      expect(stored.find((operation) => operation.operationId === chosen.operationId)?.duplicateResolution).toEqual(
        chosen.duplicateResolution,
      );
    },
  );
  it('opens a clean import after leaving successfully saved results', async () => {
    const view = show();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Popraw i zatwierdź' })).toBeEnabled());
    await approve();
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz wybrane (1/20)' }));
    expect(await screen.findByText('Zapisano w kalendarzu.')).toBeInTheDocument();
    view.unmount();
    show(null);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dodaj ręcznie propozycję' })).toBeEnabled());
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/Zatwierdzone:/)).not.toBeInTheDocument();
    expect(screen.getByText('Zapisane: 0. Wymagają poprawy: 0. Nieznany wynik: 0.')).toBeInTheDocument();
  });
  it.each([null, '18:30'])('approves recognized data without editing and preserves time %s', async (time) => {
    const recognized = parseOcrEvents({
      image: { width: 1000, height: 1000 },
      lines: [
        { id: '1', text: 'Dogoterapia', box: { x: 0.1, y: 0.1, width: 0.6, height: 0.04 } },
        {
          id: '2',
          text: `21.10.2026${time ? ` godz. ${time}` : ''}`,
          box: { x: 0.1, y: 0.2, width: 0.6, height: 0.04 },
        },
      ],
    });
    show(recognized);
    const approve = await screen.findByRole('button', { name: 'Zatwierdź propozycję' });
    await waitFor(() => expect(approve).toBeEnabled());
    fireEvent.click(approve);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const checkbox = screen.getByRole('checkbox', { name: 'Wybierz do zapisu: Dogoterapia' });
    expect(checkbox).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz wybrane (1/20)' }));
    expect(await screen.findByText('Zapisano w kalendarzu.')).toBeInTheDocument();
    expect(JSON.parse(api.mock.calls[0]![1].body).items[0].event).toMatchObject({
      startDate: '2026-10-21',
      startTime: time,
      durationMinutes: null,
      participantIds: [],
    });
  });

  it('requires editing for a missing year rather than approving a guessed date', async () => {
    show();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Popraw i zatwierdź' })).toBeEnabled());
    expect(screen.queryByRole('button', { name: 'Zatwierdź propozycję' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
  it('limits a batch to 20 selected approvals and permits discarding an unsent proposal', async () => {
    stored = Array.from({ length: 21 }, (_, index) => {
      const operationId = crypto.randomUUID();
      return {
        operationId,
        event: {
          title: `Pozycja ${index}`,
          startDate: '2026-11-12',
          startTime: null,
          durationMinutes: null,
          description: null,
          location: null,
          participantIds: [],
          kind: 'single',
          datePrecision: 'day',
          rrule: null,
        },
        result: { operationId, status: 'error', error: { code: 'VALIDATION_ERROR', message: 'Popraw dane' } },
      };
    });
    show(null);
    await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(21));
    act(() => {
      screen.getAllByRole('checkbox').forEach((checkbox) => fireEvent.click(checkbox));
    });
    expect(screen.getByRole('button', { name: 'Zapisz wybrane (21/20)' })).toBeDisabled();
    expect(api).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Odrzuć propozycję' })[20]!);
    await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(20));
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz wybrane (20/20)' }));
    await waitFor(() => expect(api).toHaveBeenCalledOnce());
    expect(JSON.parse(api.mock.calls[0]![1].body).items).toHaveLength(20);
  }, 15000);

  it('retains unknown state if saving the response fails and still refreshes successful events', async () => {
    show();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Popraw i zatwierdź' })).toBeEnabled());
    await approve();
    const persist = write.getMockImplementation()!;
    write.mockImplementationOnce(persist).mockRejectedValueOnce(new Error('Nie zapisano wyniku'));
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz wybrane (1/20)' }));
    expect(await screen.findByText(/Nie zapisano wyniku/)).toBeInTheDocument();
    expect(stored[0]!.result).toBeUndefined();
    expect(stale).toHaveBeenCalledOnce();
    const body = api.mock.calls[0]![1].body;
    fireEvent.click(screen.getByRole('button', { name: 'Ponów nieznane wyniki (1)' }));
    expect(await screen.findByText('Zapisano w kalendarzu.')).toBeInTheDocument();
    expect(api.mock.calls[1]![1].body).toBe(body);
  });
  it('requires explicit year, time/all-day choice and approval before selection; saves only approved data', async () => {
    show();
    expect(await screen.findByRole('checkbox')).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Popraw i zatwierdź' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Popraw i zatwierdź' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByLabelText(/^Data/)).toHaveValue('');
    expect(dialog.getByLabelText(/^Godzina/)).toHaveValue('');
    expect(dialog.getByRole('switch', { name: 'Bez godziny' })).not.toBeChecked();
    fireEvent.submit(dialog.getByRole('button', { name: 'Zatwierdź do paczki' }).closest('form')!);
    expect(api).not.toHaveBeenCalled();
    fireEvent.change(dialog.getByLabelText(/^Data/), { target: { value: '2026-11-12' } });
    fireEvent.click(dialog.getByRole('switch', { name: 'Bez godziny' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Zatwierdź do paczki' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz wybrane (1/20)' }));
    expect(await screen.findByText('Zapisano w kalendarzu.')).toBeInTheDocument();
    expect(api).toHaveBeenCalledOnce();
    const body = JSON.parse(api.mock.calls[0]![1].body);
    expect(body.items[0].event).toMatchObject({
      kind: 'single',
      participantIds: [],
      startDate: '2026-11-12',
      startTime: null,
    });
    expect(body.items[0].event.reminders ?? []).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('source');
    expect(stale).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
  });
  it('preserves partial success and rejected data across restart, then assigns a new ID to a corrected rejection', async () => {
    const view = show();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Popraw i zatwierdź' })).toBeEnabled());
    await approve();
    await approve('Drugie wydarzenie');
    api.mockImplementationOnce(async (_url, init) => {
      const { items } = JSON.parse(init.body) as { items: PhotoImportOperation[] };
      return {
        ok: true,
        results: [
          { operationId: items[0]!.operationId, status: 'created', eventId: crypto.randomUUID() },
          {
            operationId: items[1]!.operationId,
            status: 'error',
            error: { code: 'INVALID_EVENT', message: 'Popraw tytuł' },
          },
        ],
      };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz wybrane (2/20)' }));
    expect(await screen.findByText('Wymaga poprawy: Popraw tytuł')).toBeInTheDocument();
    expect(stale).toHaveBeenCalledOnce();
    const oldId = stored[1]!.operationId;
    view.unmount();
    show(null);
    expect(await screen.findByText('Wymaga poprawy: Popraw tytuł')).toBeInTheDocument();
    fireEvent.click(
      screen
        .getAllByRole('button', { name: 'Popraw propozycję' })
        .find((button) => !(button as HTMLButtonElement).disabled)!,
    );
    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.change(dialog.getByLabelText(/^Tytuł/), { target: { value: 'Poprawione' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Zatwierdź do paczki' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Wybierz do zapisu: Poprawione' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz wybrane (1/20)' }));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    const next = JSON.parse(api.mock.calls[1]![1].body).items[0];
    expect(next.operationId).not.toBe(oldId);
    expect(next.event.title).toBe('Poprawione');
  });
  it('freezes unknown outcomes and retries the same payload after restart without double clicks', async () => {
    const view = show();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Popraw i zatwierdź' })).toBeEnabled());
    await approve();
    api.mockRejectedValueOnce(new Error('Utrata odpowiedzi'));
    const save = screen.getByRole('button', { name: 'Zapisz wybrane (1/20)' });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(await screen.findByText(/Nie udało się zakończyć zapisu/)).toBeInTheDocument();
    expect(api).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Popraw propozycję' })).toBeDisabled();
    const body = api.mock.calls[0]![1].body;
    view.unmount();
    show(null);
    fireEvent.click(await screen.findByRole('button', { name: 'Ponów nieznane wyniki (1)' }));
    expect(await screen.findByText('Zapisano w kalendarzu.')).toBeInTheDocument();
    expect(api.mock.calls[1]![1].body).toBe(body);
  });
  it('blocks requests on storage failure and offline, and ignores a late response after account cleanup', async () => {
    const view = show();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Popraw i zatwierdź' })).toBeEnabled());
    await approve();
    write.mockRejectedValueOnce(new Error('Brak pamięci'));
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz wybrane (1/20)' }));
    expect(await screen.findByText(/Brak pamięci/)).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
    network.offline = true;
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz wybrane (1/20)' }));
    expect(api).not.toHaveBeenCalled();
    network.offline = false;
    let resolve!: (value: unknown) => void;
    api.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz wybrane (1/20)' }));
    await waitFor(() => expect(api).toHaveBeenCalledOnce());
    const writes = write.mock.calls.length;
    await act(async () => {
      session.generation++;
      await clearAccountData('account-changed');
    });
    await act(async () => resolve({ ok: true, results: [] }));
    expect(write).toHaveBeenCalledTimes(writes);
    expect(stale).not.toHaveBeenCalled();
    expect(screen.queryByText(/Zatwierdzone:/)).not.toBeInTheDocument();
    view.unmount();
  });
});
