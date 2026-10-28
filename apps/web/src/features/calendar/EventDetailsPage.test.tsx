import { MantineProvider } from '@mantine/core';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { CalendarEvent, EventPatch, EventScope } from '@rodzina/shared';
import { EventDetailsPage } from './EventDetailsPage.js';
import { ApiRequestError } from '../../api.js';

const state = vi.hoisted(() => ({
  role: 'child',
  userId: 'child',
  event: undefined as CalendarEvent | undefined,
  error: null as Error | null,
  update: vi.fn(async (input: { id: string; data: EventPatch; scope?: EventScope }): Promise<CalendarEvent> => {
    void input;
    return { ...state.event!, id: 'new-series', startDate: '2026-10-13' };
  }),
  remove: vi.fn(async () => {}),
}));
vi.mock('../../sessionContext.js', () => ({
  useMe: () => ({ user: { id: state.userId, role: state.role }, family: { timezone: 'Europe/Warsaw' } }),
}));
vi.mock('../family/familyQueries.js', () => ({ useMembersQuery: () => ({ data: [], error: null }) }));
vi.mock('./MyReminders.js', () => ({ MyReminders: () => <div>Moje przypomnienia</div> }));
vi.mock('./calendarQueries.js', () => ({
  useCalendarReadOnly: () => !onlineManager.isOnline(),
  calendarOnlineHint: 'Dostępne po połączeniu z internetem',
  useEvent: () => ({ data: state.event, isPending: false, error: state.error }),
  useCalendarMutations: () => ({
    update: { isPending: false, mutateAsync: state.update },
    remove: { isPending: false, error: null, mutateAsync: state.remove },
  }),
}));

const event: CalendarEvent = {
  id: 'event',
  familyId: 'family',
  title: 'Basen',
  description: null,
  location: null,
  startDate: '2026-10-12',
  startTime: '17:00',
  durationMinutes: 60,
  datePrecision: 'day',
  rrule: null,
  kind: 'single',
  createdBy: 'adult',
  createdAt: 1,
  updatedAt: 1,
  participants: [],
  exceptions: [],
  reminders: [],
};

function show(date = '2026-10-12') {
  render(
    <MantineProvider env="test">
      <MemoryRouter initialEntries={[`/kalendarz/wydarzenie/event?data=${date}`]}>
        <Routes>
          <Route path="/kalendarz/wydarzenie/:eventId" element={<EventDetailsPage />} />
          <Route path="/kalendarz" element={<div>Kalendarz</div>} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
}

beforeEach(() => {
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
  state.update.mockClear();
  state.remove.mockClear();
  state.event = event;
  state.role = 'child';
  state.error = null;
});
afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('event details', () => {
  it.each(['Edytuj', 'Usuń wydarzenie'])(
    'blocks every series scope after losing connectivity in the %s dialog',
    (action) => {
      state.role = 'member';
      state.event = { ...event, kind: 'recurring', rrule: 'FREQ=DAILY;COUNT=3' };
      show('2026-10-13');
      fireEvent.click(screen.getByRole('button', { name: action }));
      act(() => onlineManager.setOnline(false));
      for (const name of ['Tylko to', 'To i następne', 'Wszystkie']) {
        expect(screen.getByRole('button', { name })).toBeDisabled();
      }
      expect(state.update).not.toHaveBeenCalled();
      expect(state.remove).not.toHaveBeenCalled();
    },
  );
  it('edits only occurrence fields while retaining the original date in the request', async () => {
    state.role = 'member';
    state.event = { ...event, kind: 'recurring', rrule: 'FREQ=DAILY;COUNT=3' };
    show('2026-10-13');
    fireEvent.click(screen.getByRole('button', { name: 'Edytuj' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tylko to' }));
    expect(screen.getByLabelText('Opis')).toBeDisabled();
    expect(screen.queryByLabelText('Zakończenie')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Data/), { target: { value: '2026-10-14' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() =>
      expect(state.update).toHaveBeenCalledWith({
        id: 'event',
        scope: { scope: 'this', occurrenceDate: '2026-10-13' },
        data: { title: 'Basen', startDate: '2026-10-14', startTime: '17:00', durationMinutes: 60 },
      }),
    );
  });
  it('shows the remaining count and lets the API retain the unchanged future pattern', async () => {
    state.role = 'member';
    state.event = { ...event, kind: 'recurring', rrule: 'FREQ=DAILY;COUNT=3' };
    show('2026-10-13');
    fireEvent.click(screen.getByRole('button', { name: 'Edytuj' }));
    fireEvent.click(screen.getByRole('button', { name: 'To i następne' }));
    expect(screen.getByLabelText(/Liczba wystąpień/)).toHaveValue('2');
    fireEvent.change(screen.getByLabelText(/^Tytuł/), { target: { value: 'Nowe zajęcia' } });
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }));
    await waitFor(() =>
      expect(state.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'event',
          scope: { scope: 'following', occurrenceDate: '2026-10-13' },
          data: expect.objectContaining({ title: 'Nowe zajęcia', startDate: '2026-10-13' }),
        }),
      ),
    );
    expect(state.update.mock.calls[0]?.[0].data).not.toHaveProperty('rrule');
  });
  it('passes the selected occurrence scope to deletion', async () => {
    state.role = 'member';
    state.event = { ...event, kind: 'recurring', rrule: 'FREQ=DAILY;COUNT=3' };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    show('2026-10-13');
    fireEvent.click(screen.getByRole('button', { name: 'Usuń wydarzenie' }));
    fireEvent.click(screen.getByRole('button', { name: 'To i następne' }));
    await waitFor(() =>
      expect(state.remove).toHaveBeenCalledWith({
        id: 'event',
        scope: { scope: 'following', occurrenceDate: '2026-10-13' },
      }),
    );
  });
  it('hides edit and delete from a child viewing an adult event', () => {
    show();
    expect(screen.getByRole('heading', { name: 'Basen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edytuj' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Usuń wydarzenie' })).not.toBeInTheDocument();
  });
  it('allows a child to edit their own event and an adult to edit every event', () => {
    state.event = { ...event, createdBy: 'child' };
    show();
    expect(screen.getByRole('button', { name: 'Edytuj' })).toBeInTheDocument();
    cleanup();
    state.role = 'member';
    state.event = event;
    show();
    expect(screen.getByRole('button', { name: 'Usuń wydarzenie' })).toBeInTheDocument();
  });
  it('handles a deleted event and a date that is not an occurrence', () => {
    state.error = new ApiRequestError('Nie znaleziono.', 404);
    show();
    expect(screen.getByRole('status')).toHaveTextContent('Tego wydarzenia już nie ma');
    cleanup();
    state.error = null;
    show('2026-10-13');
    expect(screen.getByRole('status')).toHaveTextContent('Tego wydarzenia już nie ma');
  });
  it('shows revoked access instead of rendering stale event contents', () => {
    state.error = new ApiRequestError('Brak dostępu.', 403);
    show();
    expect(screen.getByRole('status')).toHaveTextContent('Nie masz już dostępu');
    expect(screen.queryByRole('heading', { name: 'Basen' })).not.toBeInTheDocument();
  });
  it('resolves a moved exception by its original date and rejects cancelled occurrences', () => {
    state.event = {
      ...event,
      kind: 'recurring',
      rrule: 'FREQ=DAILY;COUNT=3',
      exceptions: [
        {
          id: 'exception',
          eventId: 'event',
          originalDate: '2026-10-12',
          isCancelled: false,
          overrideStartDate: '2026-10-14',
          overrideStartTime: '18:00',
          overrideDurationMinutes: 60,
          overrideTitle: 'Przesunięty basen',
        },
      ],
    };
    show();
    expect(screen.getByRole('heading', { name: 'Przesunięty basen' })).toBeInTheDocument();
    cleanup();
    state.event = {
      ...state.event,
      exceptions: state.event.exceptions.map((item) => ({ ...item, isCancelled: true })),
    };
    show();
    expect(screen.getByRole('status')).toHaveTextContent('Tego wydarzenia już nie ma');
  });
});
