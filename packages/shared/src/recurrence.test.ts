// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { describeRecurrence, rruleFromWizard, wizardFromRrule, type RecurrenceWizard } from './recurrence.js';
import { firstEventOccurrenceDate, expandOccurrences } from './time.js';

describe('recurrence wizard', () => {
  for (const frequency of ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const) {
    for (const ending of [
      { type: 'never' },
      { type: 'until', date: '2028-06-30' },
      { type: 'count', count: 8 },
    ] as const) {
      it(`round-trips ${frequency} with ${ending.type}`, () => {
        const settings: RecurrenceWizard = {
          frequency,
          interval: 2,
          weekdays: frequency === 'WEEKLY' ? ['TU', 'TH'] : [],
          ending,
        };
        expect(wizardFromRrule(rruleFromWizard(settings), '2026-10-12')).toEqual(settings);
      });
    }
  }
  it('describes weekdays and an inclusive end date in Polish', () => {
    const wizard = wizardFromRrule('FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20280630T235959', '2026-10-12')!;
    expect(describeRecurrence(wizard)).toBe('co tydzień we wtorek i czwartek do 30 czerwca 2028');
    expect(describeRecurrence({ ...wizard, interval: 2, ending: { type: 'count', count: 4 } })).toBe(
      'co 2 tygodnie we wtorek i czwartek, 4 wystąpienia',
    );
  });
  it('uses the starting weekday for implicit weekly rules and refuses unsupported patterns', () => {
    expect(wizardFromRrule('FREQ=WEEKLY', '2026-10-13')?.weekdays).toEqual(['TU']);
    for (const rule of [
      'FREQ=MONTHLY;BYDAY=2TU',
      'FREQ=WEEKLY;WKST=SU',
      'FREQ=DAILY;UNTIL=20280630T100000',
      'FREQ=DAILY;COUNT=2;UNTIL=20280630T235959',
    ]) {
      expect(wizardFromRrule(rule, '2026-10-12')).toBeNull();
    }
  });
  it('rejects empty weekdays, invalid intervals, counts and dates', () => {
    const base: RecurrenceWizard = { frequency: 'WEEKLY', interval: 1, weekdays: ['TU'], ending: { type: 'never' } };
    expect(() => rruleFromWizard({ ...base, weekdays: [] })).toThrow();
    expect(() => rruleFromWizard({ ...base, interval: 0 })).toThrow();
    expect(() => rruleFromWizard({ ...base, ending: { type: 'count', count: 1.5 } })).toThrow();
    expect(() => rruleFromWizard({ ...base, ending: { type: 'until', date: '2027-02-29' } })).toThrow();
  });
  it('includes timed events on the last day and resolves the first selected weekday', () => {
    const event = {
      id: 'event',
      startDate: '2026-10-12',
      startTime: '17:00',
      durationMinutes: 60,
      datePrecision: 'day' as const,
      rrule: rruleFromWizard({
        frequency: 'WEEKLY',
        interval: 1,
        weekdays: ['TU', 'TH'],
        ending: { type: 'until', date: '2026-10-15' },
      }),
    };
    expect(firstEventOccurrenceDate(event)).toBe('2026-10-13');
    expect(
      expandOccurrences(event, [], '2026-10-12', '2026-10-16', 'Europe/Warsaw').map((o) => o.occurrenceDate),
    ).toEqual(['2026-10-13', '2026-10-15']);
  });
});
