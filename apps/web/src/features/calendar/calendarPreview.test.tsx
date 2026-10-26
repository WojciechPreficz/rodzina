import '../../offline/testSetup.js';
import { MantineProvider } from '@mantine/core';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { localDateTimeToUtc, type CalendarEvent, type Reminder } from '@rodzina/shared';
import { CalendarPage } from './CalendarPage.js';
import { EventDetailsPage } from './EventDetailsPage.js';
import { calendarStore } from './calendarOffline.js';
import { reportTransportFailure } from '../../connectivity.js';
import { todayInTimezone } from './toScheduleX.js';

const state = vi.hoisted(() => ({
  familyId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
}));
vi.mock('../../auth.js', () => ({
  useMe: () => ({
    user: { id: state.userId, role: 'admin' },
    family: { id: state.familyId, timezone: 'Europe/Warsaw' },
    familyConfirmed: false,
  }),
}));
vi.mock('../family/familyQueries.js', () => ({
  useMembersQuery: () => ({ data: [{ id: state.userId, displayName: 'Ania', color: '#123456' }] }),
}));
vi.mock('../notifications/NotificationBanner.js', () => ({ NotificationBanner: () => null }));
vi.mock('@schedule-x/react', () => ({ useCalendarApp: () => ({}), ScheduleXCalendar: () => <div /> }));
const date = todayInTimezone('Europe/Warsaw');
const event: CalendarEvent = {
  id: '33333333-3333-4333-8333-333333333333',
  familyId: state.familyId,
  createdBy: state.userId,
  createdAt: 1,
  updatedAt: 1,
  title: 'Zapisane wydarzenie',
  description: 'Zapisany opis',
  location: null,
  startDate: date,
  startTime: null,
  durationMinutes: null,
  kind: 'single',
  rrule: null,
  datePrecision: 'day',
  participants: [],
  reminders: [],
  exceptions: [],
};
const reminder: Reminder = {
  id: '44444444-4444-4444-8444-444444444444',
  familyId: state.familyId,
  eventId: event.id,
  userId: state.userId,
  taskId: null,
  documentId: null,
  type: 'offset',
  offsetValue: 1,
  offsetUnit: 'hour',
  remindAt: null,
  audience: 'user',
  createdBy: state.userId,
  nextFireAt: null,
  lastSentAt: null,
};
const clients: QueryClient[] = [];
beforeEach(async () => {
  localStorage.clear();
  calendarStore.clear();
  await calendarStore.activate(`${state.familyId}:${state.userId}`);
  onlineManager.setOnline(false);
  reportTransportFailure(false);
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
});
afterEach(async () => {
  cleanup();
  clients.forEach((c) => c.clear());
  clients.length = 0;
  calendarStore.clear();
  onlineManager.setOnline(true);
  reportTransportFailure(false);
  vi.unstubAllGlobals();
});
function show(details = false) {
  const client = new QueryClient();
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <MantineProvider env="test">
        <MemoryRouter initialEntries={[details ? `/event/${event.id}` : '/']}>
          <Routes>
            <Route path="/" element={<CalendarPage />} />
            <Route path="/event/:eventId" element={<EventDetailsPage />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
}
async function save() {
  const startUtc = localDateTimeToUtc(date, '00:00', 'Europe/Warsaw');
  await calendarStore.saveRange(
    date.slice(0, 7),
    [
      {
        eventId: event.id,
        occurrenceDate: date,
        startUtc,
        endUtc: startUtc + 86400000,
        title: event.title,
        allDay: true,
        isException: false,
        kind: 'single',
        participants: [],
        createdBy: state.userId,
        location: null,
      },
    ],
    calendarStore.token(),
  );
  await calendarStore.saveEvent(event, calendarStore.token());
  await calendarStore.savePersonal(event.id, [reminder], calendarStore.token());
}
it('shows the offline notice and missing coverage without an infinite loader or a false empty state', async () => {
  show();
  expect(screen.getByRole('status')).toHaveTextContent('kalendarz jest dostępny tylko do odczytu');
  expect(screen.getByText(/Ten zakres nie został zapisany offline/)).toBeVisible();
  expect(screen.queryByText('Brak wydarzeń rodzinnych w wybranym zakresie.')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Ładowanie…')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Dodaj wydarzenie' })).toBeDisabled();
});
it('distinguishes a downloaded empty month from a partially saved range', async () => {
  await calendarStore.saveRange(date.slice(0, 7), [], calendarStore.token());
  show();
  expect(screen.getByText('Brak wydarzeń rodzinnych w wybranym zakresie.')).toBeVisible();
  cleanup();
  await calendarStore.saveEvent(event, calendarStore.token());
  await calendarStore.forgetEvent(event.id, calendarStore.token());
  show();
  expect(screen.getByText(/Zapisane dane są częściowe/)).toBeVisible();
  expect(screen.queryByText('Brak wydarzeń rodzinnych w wybranym zakresie.')).not.toBeInTheDocument();
});
it('filters saved occurrences locally by member while offline', async () => {
  await save();
  show();
  expect(screen.queryByText('Brak wydarzeń rodzinnych w wybranym zakresie.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ania' }));
  expect(screen.getByText('Brak wydarzeń rodzinnych w wybranym zakresie.')).toBeVisible();
});
it('restores complete details and personal reminders before fetching and disables every write', async () => {
  await save();
  calendarStore.clear(false);
  await calendarStore.activate(`${state.familyId}:${state.userId}`);
  show(true);
  expect(screen.getByRole('heading', { name: event.title })).toBeVisible();
  expect(screen.getByText('Zapisany opis')).toBeVisible();
  for (const name of ['Edytuj', 'Usuń wydarzenie', 'Dodaj przypomnienie', 'Usuń przypomnienie'])
    expect(screen.getByRole('button', { name })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Ostatnie udane pobranie');
});
it('provides a specific missing detail message and a calendar link without a loader', async () => {
  show(true);
  expect(screen.getByText(/Brak szczegółów tego wydarzenia zapisanych offline/)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Wróć do kalendarza' })).toHaveAttribute('href', '/kalendarz');
});
