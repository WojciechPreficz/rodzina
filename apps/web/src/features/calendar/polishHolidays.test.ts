import { describe, expect, it } from 'vitest';
import { Temporal } from 'temporal-polyfill';
import { isHolidayRangeSupported, polishHolidaysForYear, polishHolidaysInRange } from './polishHolidays.js';
import { holidaysToScheduleX } from './holidayLayers.js';

describe('Polish holiday dates', () => {
  it('includes the complete fixed-date catalogue and both categories', () => {
    const holidays = polishHolidaysForYear(2026);
    expect(holidays.filter((h) => h.category === 'publicHoliday')).toHaveLength(14);
    expect(holidays.filter((h) => h.category === 'observance').map((h) => [h.date, h.name])).toEqual([
      ['2026-01-21', 'Dzień Babci'],
      ['2026-01-22', 'Dzień Dziadka'],
      ['2026-02-14', 'Walentynki'],
      ['2026-03-08', 'Dzień Kobiet'],
      ['2026-03-10', 'Dzień Mężczyzn'],
      ['2026-05-26', 'Dzień Matki'],
      ['2026-06-01', 'Dzień Dziecka'],
      ['2026-06-23', 'Dzień Ojca'],
      ['2026-09-30', 'Dzień Chłopaka'],
      ['2026-10-14', 'Dzień Edukacji Narodowej (Dzień Nauczyciela)'],
      ['2026-12-06', 'Mikołajki'],
      ['2026-12-31', 'Sylwester'],
    ]);
    expect(holidays.filter((h) => h.category === 'publicHoliday').map((h) => h.date)).toEqual([
      '2026-01-01',
      '2026-01-06',
      '2026-04-05',
      '2026-04-06',
      '2026-05-01',
      '2026-05-03',
      '2026-05-24',
      '2026-06-04',
      '2026-08-15',
      '2026-11-01',
      '2026-11-11',
      '2026-12-24',
      '2026-12-25',
      '2026-12-26',
    ]);
  });

  it.each([
    [2025, '2025-04-20'],
    [2028, '2028-04-16'],
    [2038, '2038-04-25'],
    [2099, '2099-04-12'],
  ] as const)('calculates Easter and its offsets for %s', (year, date) => {
    const holidays = polishHolidaysForYear(year);
    const easter = Temporal.PlainDate.from(date);
    for (const [key, days] of [
      ['easter', 0],
      ['easter-monday', 1],
      ['pentecost', 49],
      ['corpus-christi', 60],
    ] as const) {
      expect(holidays.find((h) => h.key === key)?.date).toBe(easter.add({ days }).toString());
    }
  });

  it('keeps a public holiday and an observance on the same date', () => {
    const collision = polishHolidaysInRange({ from: '2031-06-01', to: '2031-06-01' });
    expect(collision.map((h) => h.key)).toEqual(['childrens-day', 'pentecost']);
    const events = holidaysToScheduleX(collision, { publicHoliday: true, observance: true });
    expect(new Set(events.map((event) => event.id)).size).toBe(2);
  });

  it('handles year boundaries, leap days and the supported range', () => {
    expect(polishHolidaysInRange({ from: '2025-12-31', to: '2026-01-01' }).map((h) => h.name)).toEqual([
      'Sylwester',
      'Nowy Rok',
    ]);
    expect(polishHolidaysInRange({ from: '2028-02-29', to: '2028-02-29' })).toEqual([]);
    expect(polishHolidaysForYear(2024)).toEqual([]);
    expect(polishHolidaysForYear(2100)).toEqual([]);
    expect(polishHolidaysForYear(NaN)).toEqual([]);
    expect(polishHolidaysInRange({ from: '2026-02-01', to: '2026-01-01' })).toEqual([]);
    expect(isHolidayRangeSupported({ from: '2025-01-01', to: '2099-12-31' })).toBe(true);
    expect(isHolidayRangeSupported({ from: '2024-12-31', to: '2025-01-01' })).toBe(false);
    expect(isHolidayRangeSupported({ from: '2099-12-31', to: '2100-01-01' })).toBe(false);
  });

  it('creates distinct all-day entries without instants, participants or reminders', () => {
    const holidays = polishHolidaysForYear(2026);
    const events = holidaysToScheduleX(holidays, { publicHoliday: true, observance: true });
    expect(new Set(events.map((e) => e.id)).size).toBe(26);
    for (const event of events) {
      expect(event.start).toBeInstanceOf(Temporal.PlainDate);
      expect(event.end.toString()).toBe(event.start.toString());
      expect(event).not.toHaveProperty('eventId');
      expect(event).not.toHaveProperty('reminders');
      expect(event).not.toHaveProperty('people');
    }
    expect(holidaysToScheduleX(holidays, { publicHoliday: false, observance: true })).toHaveLength(12);
    expect(holidaysToScheduleX(holidays, { publicHoliday: true, observance: false })).toHaveLength(14);
    expect(holidaysToScheduleX(holidays, { publicHoliday: false, observance: false })).toEqual([]);
  });
});
