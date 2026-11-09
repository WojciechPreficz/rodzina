import '../../offline/testing.js';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '@rodzina/shared';
import { ApiRequestError } from '../../api.js';
import { calendarStore, readCalendarRange } from './calendarOffline.js';
import { fetchSavedEvent, fetchSavedMonth, fetchSavedDistant } from './calendarSync.js';
import { getEvent, listOccurrences, listDistantEvents } from './calendarApi.js';

vi.mock('./calendarApi.js', () => ({ getEvent: vi.fn(), listOccurrences: vi.fn(), listDistantEvents: vi.fn() }));
const familyId = '11111111-1111-4111-8111-111111111111';
const event: CalendarEvent = {
  id: '33333333-3333-4333-8333-333333333333',
  familyId,
  createdBy: null,
  createdAt: 1,
  updatedAt: 1,
  title: 'Zajęcia',
  description: 'Pełny opis',
  location: null,
  startDate: '2026-10-24',
  startTime: null,
  durationMinutes: null,
  kind: 'single',
  rrule: null,
  datePrecision: 'day',
  participants: [],
  reminders: [],
  exceptions: [],
};
beforeEach(async () => {
  calendarStore.clear();
  await calendarStore.activate(`${familyId}:user`);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ reminders: [] })),
  );
  vi.mocked(getEvent).mockResolvedValue(event);
  vi.mocked(listDistantEvents).mockResolvedValue([]);
});
afterEach(async () => {
  calendarStore.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('bounds detail concurrency at four and deduplicates IDs and simultaneous ranges', async () => {
  let active = 0;
  let maximum = 0;
  vi.mocked(getEvent).mockImplementation(async (id) => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return { ...event, id };
  });
  vi.mocked(listOccurrences).mockResolvedValue(
    Array.from({ length: 20 }, (_, i) => ({
      eventId: `33333333-3333-4333-8333-${String(i % 10).padStart(12, '0')}`,
      occurrenceDate: '2026-10-24',
      title: 'Zajęcia',
      startUtc: 1,
      endUtc: 2,
      allDay: true,
      isException: false,
      participants: [],
      kind: 'single',
      createdBy: null,
      location: null,
    })),
  );
  await Promise.all([fetchSavedMonth('2026-10'), fetchSavedMonth('2026-10')]);
  expect(listOccurrences).toHaveBeenCalledTimes(1);
  expect(getEvent).toHaveBeenCalledTimes(10);
  expect(maximum).toBeLessThanOrEqual(4);
  expect(maximum).toBeGreaterThan(1);
  expect(Object.keys(calendarStore.snapshot().view?.personal ?? {})).toHaveLength(10);
});
it('retains the old preview after transport failure and refreshes it on the next successful request', async () => {
  vi.mocked(listOccurrences).mockResolvedValue([]);
  await fetchSavedMonth('2026-10');
  vi.mocked(listOccurrences).mockRejectedValueOnce(new TypeError('Network failed'));
  await expect(fetchSavedMonth('2026-10')).rejects.toThrow('Network failed');
  expect(
    readCalendarRange(calendarStore.snapshot().view, { from: '2026-10-01', to: '2026-10-31' }, 'Europe/Warsaw')
      .coverage,
  ).toBe('complete');
  await fetchSavedEvent(event.id);
  vi.mocked(getEvent).mockResolvedValueOnce({ ...event, title: 'Nowy tytuł' });
  await fetchSavedEvent(event.id);
  expect(calendarStore.snapshot().view?.details[event.id]?.event.title).toBe('Nowy tytuł');
});
it('removes 404 details and invalidates ranges', async () => {
  await calendarStore.saveEvent(event, calendarStore.token());
  vi.mocked(getEvent).mockRejectedValueOnce(new ApiRequestError('Usunięte', 404));
  await expect(fetchSavedEvent(event.id)).rejects.toThrow('Usunięte');
  expect(calendarStore.snapshot().view?.details[event.id]).toBeUndefined();
  expect(calendarStore.snapshot().view?.ranges[0]?.complete).toBe(false);
});
it.each([
  [401, true],
  [403, false],
] as const)('propagates HTTP %i and signals session loss only on 401', async (status, sessionLost) => {
  await calendarStore.saveEvent(event, calendarStore.token());
  const cached = calendarStore.snapshot().view;
  const lost = vi.fn(() => calendarStore.clear());
  window.addEventListener('rodzina:session-lost', lost);
  try {
    const calendarApi = await vi.importActual<typeof import('./calendarApi.js')>('./calendarApi.js');
    vi.mocked(getEvent).mockImplementationOnce(calendarApi.getEvent);
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { message: 'Brak dostępu' } }, { status }));
    await expect(fetchSavedEvent(event.id)).rejects.toMatchObject({ message: 'Brak dostępu', status });
    expect(lost).toHaveBeenCalledTimes(sessionLost ? 1 : 0);
    expect(calendarStore.snapshot().view).toEqual(sessionLost ? undefined : cached);
  } finally {
    window.removeEventListener('rodzina:session-lost', lost);
  }
});
it('ignores late responses from another account', async () => {
  let finish!: (value: CalendarEvent) => void;
  vi.mocked(getEvent).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const work = fetchSavedEvent(event.id);
  calendarStore.clear();
  await calendarStore.activate(`${familyId}:other`);
  finish(event);
  await expect(work).rejects.toThrow('Session changed');
  expect(calendarStore.snapshot().view).toBeUndefined();
});
it('persists distant details and personal reminders without visiting details', async () => {
  vi.mocked(listDistantEvents).mockResolvedValueOnce([{ ...event, kind: 'distant', startDate: '2030-01-01' }]);
  await fetchSavedDistant();
  expect(calendarStore.snapshot().view?.details[event.id]?.event.startDate).toBe('2030-01-01');
  expect(calendarStore.snapshot().view?.personal[event.id]).toEqual([]);
});
