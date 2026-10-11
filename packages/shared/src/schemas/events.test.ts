import { describe, expect, it } from 'vitest';
import { createEventSchema, eventDataSchema, occurrencesQuerySchema } from './events.js';

const single = { kind: 'single', title: 'Basen', startDate: '2026-10-11' };

describe('event schemas', () => {
  it('accepts all three kinds, timed and all-day events, and leap days', () => {
    for (const data of [
      single,
      { ...single, startDate: '2028-02-29' },
      { ...single, startTime: '17:00', durationMinutes: 60 },
      { ...single, kind: 'recurring', rrule: 'FREQ=WEEKLY;BYDAY=TU,TH;COUNT=8' },
      { ...single, kind: 'distant' },
      { ...single, kind: 'distant', startDate: '2028-05-01', datePrecision: 'month' },
    ]) {
      expect(createEventSchema.safeParse(data).success).toBe(true);
    }
    expect(eventDataSchema.safeParse(createEventSchema.parse(single)).success).toBe(true);
  });

  it.each([
    { kind: 'single', rrule: 'FREQ=DAILY' },
    { kind: 'recurring' },
    { kind: 'distant', rrule: 'FREQ=YEARLY' },
    { datePrecision: 'month' },
    { kind: 'recurring', rrule: 'FREQ=DAILY', datePrecision: 'month' },
    { kind: 'distant', datePrecision: 'month', startDate: '2028-05-02' },
    { kind: 'distant', datePrecision: 'month', startDate: '2028-05-01', startTime: '09:00', durationMinutes: 60 },
    { startDate: '2026-02-29' },
    { startDate: '2026-04-31' },
    { startDate: '2026-2-01' },
    { startTime: '24:00', durationMinutes: 60 },
    { startTime: '17:00' },
    { durationMinutes: 60 },
    { startTime: '17:00', durationMinutes: 0 },
    { title: '  ' },
    { reminders: [] },
    { familyId: 'untrusted' },
  ])('rejects invalid combinations %j', (patch) => {
    expect(createEventSchema.safeParse({ ...single, ...patch }).success).toBe(false);
  });

  it.each([
    'garbage',
    'FREQ=NEVER',
    'FREQ=SECONDLY',
    'FREQ=DAILY;INTERVAL=0',
    'FREQ=DAILY;COUNT=-1',
    'FREQ=DAILY;DTSTART=20261011T170000',
    'DTSTART:20261011T170000\nRRULE:FREQ=DAILY',
    'FREQ=DAILY;BYHOUR=1,2',
    'FREQ=MONTHLY;BYMONTHDAY=32',
    'FREQ=YEARLY;BYMONTH=13',
    'FREQ=DAILY;UNTIL=20260230T170000Z',
    'FREQ=DAILY;UNTIL=20261201T250000Z',
    'FREQ=DAILY;COUNT=2;UNTIL=20261201',
    'FREQ=DAILY;COUNT=2;COUNT=3',
    'FREQ=DAILY;COUNT=1.5',
    'FREQ=DAILY;INTERVAL=1abc',
    'FREQ=DAILY;UNTIL=',
    'FREQ=MONTHLY;BYDAY=99MO',
    'FREQ=MONTHLY;BYDAY=0MO',
    'FREQ=WEEKLY;BYDAY=1MO',
    'FREQ=MONTHLY;BYMONTHDAY=',
    'FREQ=DAILY;WKST=XX',
  ])('rejects invalid RRULE %s', (rrule) => {
    expect(createEventSchema.safeParse({ ...single, kind: 'recurring', rrule }).success).toBe(false);
  });

  it('validates the inclusive range of at most 62 calendar days', () => {
    expect(occurrencesQuerySchema.safeParse({ from: '2026-01-01', to: '2026-03-03' }).success).toBe(true);
    expect(occurrencesQuerySchema.safeParse({ from: '2026-01-01', to: '2026-03-04' }).success).toBe(false);
    expect(occurrencesQuerySchema.safeParse({ from: '2026-01-01', to: '2025-12-31' }).success).toBe(false);
  });
});
