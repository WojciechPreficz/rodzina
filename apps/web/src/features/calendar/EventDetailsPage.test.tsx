import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { CalendarEvent } from '@rodzina/shared';
import { EventDetailsPage } from './EventDetailsPage.js';
import { ApiRequestError } from '../../api.js';

const state = vi.hoisted(() => ({
  role: 'child',
  userId: 'child',
  event: undefined as CalendarEvent | undefined,
  error: null as Error | null,
}));
vi.mock('../../auth.js', () => ({
  useMe: () => ({ user: { id: state.userId, role: state.role }, family: { timezone: 'Europe/Warsaw' } }),
}));
vi.mock('../family/familyQueries.js', () => ({ useMembersQuery: () => ({ data: [], error: null }) }));
vi.mock('./calendarQueries.js', () => ({
  useEvent: () => ({ data: state.event, isPending: false, error: state.error }),
  useCalendarMutations: () => ({ update: { isPending: false }, remove: { isPending: false, error: null } }),
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
    <MantineProvider>
      <MemoryRouter initialEntries={[`/kalendarz/wydarzenie/event?data=${date}`]}>
        <Routes>
          <Route path="/kalendarz/wydarzenie/:eventId" element={<EventDetailsPage />} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
}

beforeEach(() => {
  state.event = event;
  state.role = 'child';
  state.error = null;
});
afterEach(cleanup);

describe('event details', () => {
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
