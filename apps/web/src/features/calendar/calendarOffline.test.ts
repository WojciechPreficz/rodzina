import '../../offline/testSetup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expandOccurrences, occurrencesQuerySchema, type CalendarEvent } from '@rodzina/shared';
import { CALENDAR_STORAGE_KEY, CalendarOfflineStore, monthWindow, readCalendarRange } from './calendarOffline.js';
import type { CalendarOccurrence } from './calendarApi.js';

const familyId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const event: CalendarEvent = {
  id: '33333333-3333-4333-8333-333333333333',
  familyId,
  createdBy: userId,
  createdAt: 1,
  updatedAt: 1,
  title: 'Zajęcia',
  description: 'Pełny opis',
  location: null,
  startDate: '2026-10-24',
  startTime: '09:00',
  durationMinutes: 60,
  kind: 'recurring',
  rrule: 'FREQ=DAILY;COUNT=3',
  datePrecision: 'day',
  participants: [{ id: userId, displayName: 'Ania', color: '#123456' }],
  reminders: [],
  exceptions: [],
};
const timezone = 'Europe/Warsaw';
const occurrences = (): CalendarOccurrence[] =>
  expandOccurrences(event, [], '2026-10-01', '2026-10-31', timezone).map((o) => ({
    ...o,
    title: event.title,
    location: null,
    kind: event.kind,
    createdBy: userId,
    participants: event.participants,
  }));
let store: CalendarOfflineStore;
beforeEach(async () => {
  localStorage.clear();
  store = new CalendarOfflineStore();
  await store.activate(`${familyId}:${userId}`);
});
afterEach(async () => vi.restoreAllMocks());
const read = (from: string, to = from) => readCalendarRange(store.snapshot(), { from, to }, timezone);

describe('durable calendar preview', () => {
  it('restores full details, monthly coverage, participants and empty personal reminders after a cold start', async () => {
    await store.saveRange('2026-10', occurrences(), store.token());
    await store.saveEvent(event, store.token());
    await store.savePersonal(event.id, [], store.token());
    store = new CalendarOfflineStore();
    await store.activate(`${familyId}:${userId}`);
    expect(store.snapshot().details[event.id]?.event).toEqual(event);
    expect(store.snapshot().personal[event.id]).toEqual([]);
    expect(read('2026-10-24').data).toHaveLength(1);
    expect(read('2026-10-19', '2026-10-25').data).toHaveLength(2);
    expect(read('2026-10-01', '2026-10-31').coverage).toBe('complete');
    expect(read('2026-10-24').data[0]?.participants[0]?.id).toBe(userId);
  });
  it('distinguishes missing, partial and confirmed empty ranges', async () => {
    expect(read('2026-10-01').coverage).toBe('missing');
    await store.saveRange('2026-10', [], store.token());
    expect(read('2026-10-01')).toMatchObject({ coverage: 'complete', data: [] });
    expect(read('2026-10-01', '2026-12-01').coverage).toBe('partial');
    expect(read('2026-12-01').coverage).toBe('missing');
  });
  it('uses the newest downloaded overlap, including deletions, and retains data regardless of age', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1);
    await store.saveRange('2026-10', occurrences(), store.token());
    await store.saveEvent(event, store.token());
    vi.mocked(Date.now).mockReturnValue(100);
    await store.saveRange('2026-10', [], store.token());
    expect(read('2026-10-24').data).toEqual([]);
    expect(store.snapshot().details[event.id]).toBeUndefined();
    vi.mocked(Date.now).mockReturnValue(9999999999999);
    store = new CalendarOfflineStore();
    await store.activate(`${familyId}:${userId}`);
    expect(read('2026-10-24').coverage).toBe('complete');
  });
  it('keeps 12 most recently used months and removes their unreferenced details', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1);
    await store.saveRange('2026-10', occurrences(), store.token());
    await store.saveEvent(event, store.token());
    for (let month = 1; month <= 12; month++) {
      vi.mocked(Date.now).mockReturnValue(month + 1);
      await store.saveRange(`2027-${String(month).padStart(2, '0')}`, [], store.token());
    }
    expect(store.snapshot().ranges).toHaveLength(12);
    expect(read('2026-10-24').coverage).toBe('missing');
    expect(store.snapshot().details[event.id]).toBeUndefined();
    vi.mocked(Date.now).mockReturnValue(100);
    await store.touch({ from: '2027-01-10', to: '2027-01-10' });
    vi.mocked(Date.now).mockReturnValue(101);
    await store.saveRange('2028-01', [], store.token());
    expect(store.snapshot().ranges.some((r) => r.month === '2027-01')).toBe(true);
  });
  it('enforces the API 62-day limit for every month including leap years', async () => {
    for (const year of [2026, 2028])
      for (let month = 1; month <= 12; month++)
        expect(occurrencesQuerySchema.safeParse(monthWindow(`${year}-${String(month).padStart(2, '0')}`)).success).toBe(
          true,
        );
  });
  it('handles Europe/Warsaw DST and moved/cancelled series exceptions without re-expanding saved occurrences', async () => {
    const items = occurrences();
    expect(items[1]!.startUtc - items[0]!.startUtc).toBe(25 * 3600000);
    await store.saveRange(
      '2026-10',
      [
        items[0]!,
        {
          ...items[1]!,
          title: 'Przeniesione',
          startUtc: items[2]!.startUtc,
          endUtc: items[2]!.endUtc,
          isException: true,
        },
      ],
      store.token(),
    );
    expect(read('2026-10-25').data).toEqual([]);
    expect(read('2026-10-26').data[0]).toMatchObject({
      title: 'Przeniesione',
      occurrenceDate: '2026-10-25',
      isException: true,
    });
  });
  it('invalidates affected ranges after a 404 and keeps unrelated data', async () => {
    await store.saveRange('2026-10', occurrences(), store.token());
    await store.saveEvent(event, store.token());
    await store.forgetEvent(event.id, store.token());
    expect(store.snapshot().details[event.id]).toBeUndefined();
    expect(read('2026-10-24')).toMatchObject({ coverage: 'partial', data: [] });
  });
  it('preserves distant details while bounding month data', async () => {
    const distant = { ...event, kind: 'distant' as const, rrule: null, startDate: '2030-01-01' };
    await store.saveDistant([distant], store.token());
    expect(store.snapshot().details[event.id]?.event).toEqual(distant);
    await store.saveDistant([], store.token());
    expect(store.snapshot().details[event.id]).toBeUndefined();
  });
  it('clears accounts, rejects late responses and never restores another user’s personal reminders', async () => {
    const token = store.token();
    await store.saveRange('2026-10', occurrences(), token);
    store.clear();
    await store.activate(`${familyId}:44444444-4444-4444-8444-444444444444`);
    await store.saveEvent(event, token);
    await store.saveRange('2026-10', occurrences(), token);
    expect(store.snapshot().details).toEqual({});
    expect(store.snapshot().ranges).toEqual([]);
    expect(localStorage.getItem(CALENDAR_STORAGE_KEY)).toBeNull();
  });
  it('reports corrupt, inaccessible and full storage without claiming persistence', async () => {
    localStorage.setItem(CALENDAR_STORAGE_KEY, '{bad');
    store = new CalendarOfflineStore();
    await store.activate(`${familyId}:${userId}`);
    expect(store.issue).toContain('odczytać');
    localStorage.removeItem(CALENDAR_STORAGE_KEY);
    store.clear(false);
    await store.activate(`${familyId}:${userId}`);
    const { IDBObjectStore } = await import('fake-indexeddb');
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    await store.saveRange('2026-10', occurrences(), store.token());
    expect(store.issue).toContain('Nie można zapisać');
    expect(read('2026-10-24').data).toHaveLength(1);
    const { readCache } = await import('../../offline/database.js');
    expect(await readCache('calendar', `${familyId}:${userId}`)).toBeUndefined();
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    store.clear();
    expect(store.issue).toContain('Nie można usunąć');
  });
});
