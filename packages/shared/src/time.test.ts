// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  computeNextFireAt,
  expandOccurrences,
  localDateTimeToUtc,
  type TimeEvent,
  type TimeException,
  type TimeReminder,
} from './index.js';

const TZ = 'Europe/Warsaw';
const utc = (iso: string) => Date.parse(iso);
const event = (changes: Partial<TimeEvent> = {}): TimeEvent => ({
  id: 'event-1',
  startDate: '2026-03-24',
  startTime: '17:00',
  durationMinutes: 60,
  datePrecision: 'day',
  rrule: null,
  ...changes,
});
const offset = (offsetValue: number, offsetUnit: 'minute' | 'hour' | 'day' | 'week' | 'month'): TimeReminder => ({
  type: 'offset',
  offsetValue,
  offsetUnit,
});

describe('expandOccurrences', () => {
  it.each([
    ['2026-03-24', '2026-03-31', '2026-03-24T16:00:00Z', '2026-03-31T15:00:00Z'],
    ['2026-10-20', '2026-10-27', '2026-10-20T15:00:00Z', '2026-10-27T16:00:00Z'],
  ])('keeps Tuesday at 17:00 across DST starting %s', (startDate, to, first, second) => {
    const result = expandOccurrences(
      event({ startDate, rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=2' }),
      [],
      startDate,
      to,
      TZ,
    );
    expect(result.map((item) => item.startUtc)).toEqual([utc(first), utc(second)]);
    expect(result.map((item) => item.endUtc - item.startUtc)).toEqual([3_600_000, 3_600_000]);
    expect(result.map((item) => item.occurrenceDate)).toEqual([startDate, to]);
  });

  it.each(['FREQ=WEEKLY;BYDAY=TU;COUNT=2', 'FREQ=WEEKLY;BYDAY=TU;UNTIL=20260331T170000Z'])(
    'respects inclusive limits: %s',
    (rrule) => {
      expect(
        expandOccurrences(event({ rrule }), [], '2026-03-01', '2026-04-30', TZ).map((item) => item.occurrenceDate),
      ).toEqual(['2026-03-24', '2026-03-31']);
      expect(expandOccurrences(event({ rrule }), [], '2026-04-01', '2026-04-30', TZ)).toEqual([]);
    },
  );

  it('includes both date boundaries and returns only matching single events', () => {
    const result = expandOccurrences(event(), [], '2026-03-24', '2026-03-24', TZ);
    expect(result).toEqual([
      {
        eventId: 'event-1',
        occurrenceDate: '2026-03-24',
        startUtc: utc('2026-03-24T16:00:00Z'),
        endUtc: utc('2026-03-24T17:00:00Z'),
        allDay: false,
        isException: false,
      },
    ]);
    expect(expandOccurrences(event(), [], '2026-03-25', '2026-03-31', TZ)).toEqual([]);
  });

  it('cancels and moves occurrences, preserving their original identity', () => {
    const exceptions: TimeException[] = [
      { originalDate: '2026-03-24', isCancelled: true },
      {
        originalDate: '2026-03-31',
        isCancelled: false,
        overrideStartDate: '2026-04-02',
        overrideStartTime: '18:30',
        overrideDurationMinutes: 90,
      },
    ];
    const series = event({ rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=3' });
    expect(expandOccurrences(series, exceptions, '2026-03-24', '2026-03-31', TZ)).toEqual([]);
    expect(expandOccurrences(series, exceptions, '2026-04-02', '2026-04-02', TZ)).toEqual([
      {
        eventId: 'event-1',
        occurrenceDate: '2026-03-31',
        startUtc: utc('2026-04-02T16:30:00Z'),
        endUtc: utc('2026-04-02T18:00:00Z'),
        allDay: false,
        isException: true,
      },
    ]);
  });

  it('includes moved-in occurrences once, sorts by effective start, and ignores orphan exceptions', () => {
    const series = event({ rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=3' });
    const exceptions: TimeException[] = [
      { originalDate: '2026-04-07', isCancelled: false, overrideStartDate: '2026-03-25' },
      { originalDate: '2026-03-31', isCancelled: false, overrideStartDate: '2026-03-24', overrideStartTime: '16:00' },
      { originalDate: '2026-04-14', isCancelled: false, overrideStartDate: '2026-03-26' },
    ];
    expect(
      expandOccurrences(series, exceptions, '2026-03-24', '2026-03-31', TZ).map((item) => item.occurrenceDate),
    ).toEqual(['2026-03-31', '2026-03-24', '2026-04-07']);
  });

  it('inherits omitted overrides and allows an explicit all-day override', () => {
    const result = expandOccurrences(
      event({ rrule: 'FREQ=WEEKLY;COUNT=2' }),
      [
        { originalDate: '2026-03-24', isCancelled: false, overrideStartDate: '2026-03-25' },
        { originalDate: '2026-03-31', isCancelled: false, overrideStartTime: null, overrideDurationMinutes: null },
      ],
      '2026-03-24',
      '2026-03-31',
      TZ,
    );
    expect(result[0]?.startUtc).toBe(utc('2026-03-25T16:00:00Z'));
    expect(result[1]).toMatchObject({
      allDay: true,
      startUtc: utc('2026-03-30T22:00:00Z'),
      endUtc: utc('2026-03-31T22:00:00Z'),
    });
  });

  it.each([
    ['2026-03-29', '2026-03-28T23:00:00Z', '2026-03-29T22:00:00Z', 23],
    ['2026-10-25', '2026-10-24T22:00:00Z', '2026-10-25T23:00:00Z', 25],
  ])('ends all-day events at the next local midnight on %s', (startDate, start, end, hours) => {
    const [result] = expandOccurrences(
      event({ startDate, startTime: null, durationMinutes: null }),
      [],
      startDate,
      startDate,
      TZ,
    );
    expect(result?.startUtc).toBe(utc(start));
    expect(result?.endUtc).toBe(utc(end));
    expect((result!.endUtc - result!.startUtc) / 3_600_000).toBe(hours);
  });

  it('excludes month-precision distant events but includes day-precision distant events', () => {
    expect(
      expandOccurrences(
        event({ startDate: '2028-05-01', startTime: null, durationMinutes: null, datePrecision: 'month' }),
        [],
        '2028-05-01',
        '2028-05-31',
        TZ,
      ),
    ).toEqual([]);
    expect(expandOccurrences(event({ startDate: '2028-05-17' }), [], '2028-05-01', '2028-05-31', TZ)).toHaveLength(1);
  });

  it('uses the supplied timezone and validates date ranges', () => {
    expect(expandOccurrences(event(), [], '2026-03-24', '2026-03-24', 'America/New_York')[0]?.startUtc).toBe(
      utc('2026-03-24T21:00:00Z'),
    );
    expect(() => expandOccurrences(event(), [], '2026-03-25', '2026-03-24', TZ)).toThrow(RangeError);
    expect(() => expandOccurrences(event(), [], '2026-02-30', '2026-03-24', TZ)).toThrow(RangeError);
    expect(() =>
      expandOccurrences(
        event({ rrule: 'DTSTART:20260324T170000Z\nRRULE:FREQ=DAILY' }),
        [],
        '2026-03-24',
        '2026-03-25',
        TZ,
      ),
    ).toThrow(RangeError);
  });
});

describe('computeNextFireAt', () => {
  const before = utc('2026-01-01T00:00:00Z');

  it.each([
    ['2026-03-31', '2026-03-30T15:00:00Z'],
    ['2026-10-27', '2026-10-26T16:00:00Z'],
    // The Sunday-to-Monday pair actually straddles the DST transition.
    ['2026-03-30', '2026-03-29T15:00:00Z'],
    ['2026-03-29', '2026-03-28T16:00:00Z'],
    ['2026-10-25', '2026-10-24T15:00:00Z'],
  ])('keeps the local time for one calendar day before %s', (startDate, expected) => {
    expect(computeNextFireAt(offset(1, 'day'), event({ startDate }), before, TZ)).toBe(utc(expected));
  });

  it.each([
    ['2026-03-29', '2026-03-28T15:00:00Z'],
    ['2026-10-25', '2026-10-24T16:00:00Z'],
  ])('subtracts hours as elapsed UTC time across DST on %s', (startDate, expected) => {
    expect(computeNextFireAt(offset(24, 'hour'), event({ startDate }), before, TZ)).toBe(utc(expected));
  });

  it('supports minute and week offsets, including calendar weeks across DST', () => {
    expect(computeNextFireAt(offset(15, 'minute'), event(), before, TZ)).toBe(utc('2026-03-24T15:45:00Z'));
    expect(computeNextFireAt(offset(1, 'week'), event({ startDate: '2026-03-31' }), before, TZ)).toBe(
      utc('2026-03-24T16:00:00Z'),
    );
  });

  it.each([
    ['2027-05-31', 3, '2027-02-28T16:00:00Z'],
    ['2028-05-31', 3, '2028-02-29T16:00:00Z'],
    ['2027-03-31', 1, '2027-02-28T16:00:00Z'],
    ['2028-03-31', 1, '2028-02-29T16:00:00Z'],
  ])('clamps %s minus %i months to the last day of February', (startDate, amount, expected) => {
    expect(computeNextFireAt(offset(amount, 'month'), event({ startDate }), before, TZ)).toBe(utc(expected));
  });

  it('calculates three reminders for a distant event two years ahead', () => {
    const distant = event({ startDate: '2028-05-31', startTime: null, durationMinutes: null });
    expect(
      [offset(3, 'month'), offset(1, 'week'), offset(1, 'day')].map((reminder) =>
        computeNextFireAt(reminder, distant, before, TZ),
      ),
    ).toEqual([utc('2028-02-29T08:00:00Z'), utc('2028-05-24T07:00:00Z'), utc('2028-05-30T07:00:00Z')]);
  });

  it('uses 09:00 for month precision, all-day events and generic deadlines', () => {
    const monthly = event({ startDate: '2028-05-01', startTime: null, durationMinutes: null, datePrecision: 'month' });
    expect(computeNextFireAt(offset(0, 'day'), monthly, before, TZ)).toBe(utc('2028-05-01T07:00:00Z'));
    expect(computeNextFireAt(offset(0, 'day'), { date: '2026-03-29' }, before, TZ)).toBe(utc('2026-03-29T07:00:00Z'));
    expect(computeNextFireAt(offset(0, 'day'), { date: '2026-03-29', time: '18:00' }, before, TZ)).toBe(
      utc('2026-03-29T16:00:00Z'),
    );
  });

  it('moves offset reminders with the deadline and leaves absolute reminders unchanged', () => {
    const absolute: TimeReminder = { type: 'absolute', remindAt: utc('2026-03-20T12:00:00Z') };
    const moved = event({ startDate: '2026-04-07' });
    expect(computeNextFireAt(offset(1, 'day'), event(), before, TZ)).toBe(utc('2026-03-23T16:00:00Z'));
    expect(computeNextFireAt(offset(1, 'day'), moved, before, TZ)).toBe(utc('2026-04-06T15:00:00Z'));
    expect(computeNextFireAt(absolute, event(), before, TZ)).toBe(absolute.remindAt);
    expect(computeNextFireAt(absolute, moved, before, TZ)).toBe(absolute.remindAt);
    expect(computeNextFireAt(absolute, moved, utc('2026-03-21T00:00:00Z'), TZ)).toBeNull();
  });

  it('selects the next future reminder rather than an occurrence whose reminder has passed', () => {
    const series = event({ rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=3' });
    const firstFire = utc('2026-03-23T16:00:00Z');
    expect(computeNextFireAt(offset(1, 'day'), series, firstFire - 1, TZ)).toBe(firstFire);
    expect(computeNextFireAt(offset(1, 'day'), series, firstFire, TZ)).toBe(utc('2026-03-30T15:00:00Z'));
    expect(computeNextFireAt(offset(1, 'day'), series, utc('2026-03-24T10:00:00Z'), TZ)).toBe(
      utc('2026-03-30T15:00:00Z'),
    );
  });

  it.each(['FREQ=WEEKLY;COUNT=2', 'FREQ=WEEKLY;UNTIL=20260331T170000Z'])(
    'returns null for an exhausted series: %s',
    (rrule) => {
      expect(computeNextFireAt(offset(0, 'minute'), event({ rrule }), utc('2026-04-01T00:00:00Z'), TZ)).toBeNull();
    },
  );

  it('skips cancellations and follows moved occurrences outside the ordinary series range', () => {
    const source = {
      ...event({ rrule: 'FREQ=WEEKLY;COUNT=3' }),
      exceptions: [
        { originalDate: '2026-03-24', isCancelled: true },
        { originalDate: '2026-03-31', isCancelled: false, overrideStartDate: '2026-05-01', overrideStartTime: '10:00' },
      ],
    };
    expect(computeNextFireAt(offset(1, 'day'), source, before, TZ)).toBe(utc('2026-04-06T15:00:00Z'));
    expect(computeNextFireAt(offset(1, 'day'), source, utc('2026-04-08T00:00:00Z'), TZ)).toBe(
      utc('2026-04-30T08:00:00Z'),
    );
    expect(computeNextFireAt(offset(1, 'day'), source, utc('2026-05-01T00:00:00Z'), TZ)).toBeNull();
  });

  it('selects exceptions moved before DTSTART and ignores orphan exceptions', () => {
    const source = {
      ...event({ rrule: 'FREQ=WEEKLY;COUNT=2' }),
      exceptions: [
        { originalDate: '2026-03-31', isCancelled: false, overrideStartDate: '2026-03-10' },
        { originalDate: '2026-04-07', isCancelled: false, overrideStartDate: '2026-03-01' },
      ],
    };
    expect(computeNextFireAt(offset(0, 'minute'), source, before, TZ)).toBe(utc('2026-03-10T16:00:00Z'));
  });

  it('has no fixed search horizon and finds infrequent occurrences with long offsets', () => {
    const series = event({ startDate: '2026-05-31', rrule: 'FREQ=YEARLY;INTERVAL=10;COUNT=2' });
    expect(computeNextFireAt(offset(24, 'month'), series, utc('2026-06-01T00:00:00Z'), TZ)).toBe(
      utc('2034-05-31T15:00:00Z'),
    );
  });

  it('does not skip a month-end recurrence when searching with a month offset', () => {
    const series = event({ startDate: '2027-03-31', rrule: 'FREQ=MONTHLY;BYMONTHDAY=31;COUNT=2' });
    expect(computeNextFireAt(offset(1, 'month'), series, utc('2027-02-28T15:59:59Z'), TZ)).toBe(
      utc('2027-02-28T16:00:00Z'),
    );
    expect(computeNextFireAt(offset(1, 'month'), series, utc('2027-02-28T16:00:00Z'), TZ)).toBe(
      utc('2027-04-30T15:00:00Z'),
    );
  });

  it('returns null for past offsets, completed sources and missing deadlines', () => {
    expect(computeNextFireAt(offset(0, 'minute'), event(), utc('2026-03-24T16:00:00Z'), TZ)).toBeNull();
    expect(computeNextFireAt(offset(1, 'day'), { date: null }, before, TZ)).toBeNull();
    expect(computeNextFireAt(offset(0, 'day'), { date: '2026-03-24', completed: true }, before, TZ)).toBeNull();
    expect(
      computeNextFireAt(
        { type: 'absolute', remindAt: utc('2028-01-01T00:00:00Z') },
        { date: '2026-03-24', completed: true },
        before,
        TZ,
      ),
    ).toBeNull();
    expect(computeNextFireAt(offset(0, 'day'), { date: '2026-03-24', completed: false }, before, TZ)).toBe(
      utc('2026-03-24T08:00:00Z'),
    );
  });

  it('requires strictly future absolute reminders and non-negative integer offsets', () => {
    expect(computeNextFireAt({ type: 'absolute', remindAt: before }, event(), before, TZ)).toBeNull();
    expect(computeNextFireAt({ type: 'absolute', remindAt: before + 1 }, event(), before, TZ)).toBe(before + 1);
    expect(() => computeNextFireAt(offset(-1, 'day'), event(), before, TZ)).toThrow(RangeError);
    expect(() => computeNextFireAt(offset(1.5, 'day'), event(), before, TZ)).toThrow(RangeError);
  });
});

describe('localDateTimeToUtc', () => {
  it('converts wall-clock fields using the supplied timezone', () => {
    expect(localDateTimeToUtc('2026-03-31', '17:00', TZ)).toBe(utc('2026-03-31T15:00:00Z'));
    expect(localDateTimeToUtc('2026-03-31', '17:00', 'UTC')).toBe(utc('2026-03-31T17:00:00Z'));
    expect(() => localDateTimeToUtc('2026-03-31', '24:00', TZ)).toThrow(RangeError);
  });
});
