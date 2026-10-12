import { describe, expect, it } from 'vitest';
import { toScheduleX, monthRange } from './toScheduleX.js';
import type { CalendarOccurrence } from './calendarApi.js';

const event: CalendarOccurrence = {
  eventId: 'event-1',
  occurrenceDate: '2026-03-29',
  title: 'Basen',
  location: null,
  startUtc: Date.parse('2026-03-29T15:00:00Z'),
  endUtc: Date.parse('2026-03-29T16:00:00Z'),
  allDay: false,
  isException: false,
  kind: 'single',
  createdBy: null,
  participants: [
    { id: 'anna', displayName: 'Anna', color: '#112233' },
    { id: 'piotr', displayName: 'Piotr', color: '#445566' },
  ],
};

describe('Schedule-X adapter', () => {
  it('uses the family timezone independently of the browser and preserves the original occurrence date', () => {
    const result = toScheduleX([event], 'Europe/Warsaw')[0]!;
    expect(result.start.toString()).toBe('2026-03-29T17:00:00+02:00[Europe/Warsaw]');
    expect(result.end.toString()).toBe('2026-03-29T18:00:00+02:00[Europe/Warsaw]');
    expect(result.occurrenceDate).toBe('2026-03-29');
    expect(result.id).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it('uses inclusive plain dates for all-day events across the DST change', () => {
    const result = toScheduleX(
      [
        {
          ...event,
          allDay: true,
          startUtc: Date.parse('2026-03-28T23:00:00Z'),
          endUtc: Date.parse('2026-03-29T22:00:00Z'),
        },
      ],
      'Europe/Warsaw',
    )[0]!;
    expect(result.start.toString()).toBe('2026-03-29');
    expect(result.end.toString()).toBe('2026-03-29');
  });

  it('filters by any participant without duplicating the event and uses the selected member color', () => {
    expect(toScheduleX([event], 'Europe/Warsaw', ['piotr'])).toHaveLength(1);
    expect(toScheduleX([event], 'Europe/Warsaw', ['piotr'])[0]!.calendarId).toBe('piotr');
    expect(toScheduleX([event], 'Europe/Warsaw', ['other'])).toHaveLength(0);
    expect(toScheduleX([{ ...event, participants: [] }], 'Europe/Warsaw')[0]!.calendarId).toBe('family');
  });

  it('keeps the initial month request within the 62-day API limit', () => {
    const range = monthRange('2026-10-12');
    expect(range).toEqual({ from: '2026-09-24', to: '2026-11-08' });
  });
});
