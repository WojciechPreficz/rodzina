import { describe, expect, it } from 'vitest';
import { firstTaskOccurrence, nextTaskOccurrence, type TaskClosureTime } from './task-recurrence.js';
import { localDateTimeToUtc } from './time.js';
import {
  taskRecurrenceRuleSchema,
  taskSeriesTemplateSchema,
  type TaskRecurrenceRule,
} from './schemas/task-recurrence.js';
import { patchTaskSchema, taskSchema } from './schemas/tasks.js';

const rule = (fields: Partial<TaskRecurrenceRule> = {}): TaskRecurrenceRule => ({
  mode: 'schedule',
  unit: 'month',
  interval: 1,
  startDate: '2026-01-31',
  time: null,
  timezone: 'Europe/Warsaw',
  endDate: null,
  ...fields,
});
const utc = (value: string) => Date.parse(value);
const closure = (date: string, fields: Partial<TaskClosureTime> = {}): TaskClosureTime => ({
  actualAt: utc(`${date}T12:00:00Z`),
  receivedAt: utc(`${date}T12:00:00Z`),
  createdAt: utc('2020-01-01T00:00:00Z'),
  previousClosedAt: null,
  ...fields,
});
const next = (input: TaskRecurrenceRule, planned: string, date = planned) =>
  nextTaskOccurrence(input, planned, closure(date));

describe('task recurrence calendar', () => {
  it.each([
    ['2026-01-31', '2026-02-28', '2026-03-31'],
    ['2028-01-31', '2028-02-29', '2028-03-31'],
    ['2026-01-30', '2026-02-28', '2026-03-30'],
    ['2026-01-29', '2026-02-28', '2026-03-29'],
  ])('keeps the original monthly anchor %s', (startDate, second, third) => {
    const input = rule({ startDate });
    expect(firstTaskOccurrence(input)).toBe(startDate);
    expect(next(input, startDate)).toMatchObject({ status: 'ready', nextDate: second });
    expect(next(input, second)).toMatchObject({ status: 'ready', nextDate: third });
  });

  it('restores February 29 in a leap year and supports multi-year intervals', () => {
    const input = rule({ unit: 'year', startDate: '2024-02-29' });
    expect(next(input, '2024-02-29')).toMatchObject({ nextDate: '2025-02-28' });
    expect(next(input, '2027-02-28')).toMatchObject({ nextDate: '2028-02-29' });
    expect(next({ ...input, interval: 4 }, '2024-02-29')).toMatchObject({ nextDate: '2028-02-29' });
    expect(next(rule({ interval: 2 }), '2026-01-31')).toMatchObject({ nextDate: '2026-03-31' });
  });

  it('uses selected weekdays in ISO weeks anchored to the starting week', () => {
    const input = rule({ unit: 'week', interval: 2, startDate: '2026-03-04', weekdays: [5, 1] });
    expect(firstTaskOccurrence(input)).toBe('2026-03-06');
    expect(next(input, '2026-03-06')).toMatchObject({ nextDate: '2026-03-16' });
    expect(next(input, '2026-03-16')).toMatchObject({ nextDate: '2026-03-20' });
    expect(firstTaskOccurrence({ ...input, weekdays: [1] })).toBe('2026-03-16');
    expect(next(rule({ unit: 'week', startDate: '2026-03-03', interval: 2 }), '2026-03-03')).toMatchObject({
      nextDate: '2026-03-17',
    });
  });

  it('skips missed slots while returning to the schedule, including a later time today', () => {
    const input = rule({ unit: 'week', startDate: '2026-03-03' });
    expect(next(input, '2026-03-03', '2026-03-20')).toMatchObject({ nextDate: '2026-03-24' });
    expect(next({ ...input, time: '18:00' }, '2026-03-03', '2026-03-24')).toMatchObject({ nextDate: '2026-03-24' });
    expect(next(input, '2026-03-24', '2026-03-20')).toMatchObject({ nextDate: '2026-03-31' });
    expect(next(rule({ unit: 'day', interval: 3, startDate: '2026-03-01' }), '2026-03-01', '2026-03-20')).toMatchObject(
      { nextDate: '2026-03-22' },
    );
  });

  it('bases completion intervals on actual local completion, never synchronization time', () => {
    const input = rule({ mode: 'after_completion', unit: 'week', interval: 2, startDate: '2026-03-03' });
    expect(
      nextTaskOccurrence(
        input,
        '2026-03-03',
        closure('2026-03-20', {
          receivedAt: utc('2026-04-01T00:00:00Z'),
        }),
      ),
    ).toMatchObject({ nextDate: '2026-04-03' });
    expect(next(rule({ mode: 'after_completion' }), '2026-01-31')).toMatchObject({ nextDate: '2026-02-28' });
    expect(
      nextTaskOccurrence(
        rule({ mode: 'after_completion', unit: 'day' }),
        '2026-01-31',
        closure('2026-01-31', {
          actualAt: utc('2026-01-31T23:30:00Z'),
          receivedAt: utc('2026-02-02T00:00:00Z'),
        }),
      ),
    ).toMatchObject({ nextDate: '2026-02-02' });
  });

  it('includes the end date and returns null when exhausted or beyond year 9999', () => {
    expect(next(rule({ endDate: '2026-02-28' }), '2026-01-31')).toMatchObject({ nextDate: '2026-02-28' });
    expect(next(rule({ endDate: '2026-02-28' }), '2026-02-28')).toMatchObject({ nextDate: null });
    expect(next(rule({ mode: 'after_completion', endDate: '2026-02-27' }), '2026-01-31')).toMatchObject({
      nextDate: null,
    });
    expect(
      firstTaskOccurrence(rule({ unit: 'week', startDate: '2026-03-04', endDate: '2026-03-05', weekdays: [1] })),
    ).toBeNull();
    expect(
      nextTaskOccurrence(rule({ startDate: '9999-12-31' }), '9999-12-31', {
        actualAt: utc('9999-12-31T00:00:00Z'),
        receivedAt: utc('9999-12-31T00:00:00Z'),
        createdAt: 0,
        previousClosedAt: null,
      }),
    ).toMatchObject({ nextDate: null });
  });

  it('uses the existing DST resolution and restores the configured hour after the gap', () => {
    const input = rule({ unit: 'day', startDate: '2026-03-28', time: '02:30' });
    expect(next(input, '2026-03-28')).toMatchObject({ nextDate: '2026-03-29' });
    expect(new Date(localDateTimeToUtc('2026-03-29', '02:30', input.timezone)).toISOString()).toBe(
      '2026-03-29T01:30:00.000Z',
    );
    expect(new Date(localDateTimeToUtc('2026-03-30', '02:30', input.timezone)).toISOString()).toBe(
      '2026-03-30T00:30:00.000Z',
    );
    expect(new Date(localDateTimeToUtc('2026-10-25', '02:30', input.timezone)).toISOString()).toBe(
      '2026-10-25T00:30:00.000Z',
    );
    expect(next({ ...input, startDate: '2026-10-24' }, '2026-10-24')).toMatchObject({ nextDate: '2026-10-25' });
    const before = localDateTimeToUtc('2026-03-28', '12:00', input.timezone);
    const after = localDateTimeToUtc('2026-03-29', '12:00', input.timezone);
    expect(after - before).toBe(23 * 60 * 60 * 1000);
    expect(
      nextTaskOccurrence({ ...input, mode: 'after_completion' }, '2026-03-28', {
        actualAt: before,
        receivedAt: after,
        createdAt: 0,
        previousClosedAt: null,
      }),
    ).toMatchObject({ nextDate: '2026-03-29' });
  });

  it('preserves suspicious actual times for review without generating a successor', () => {
    const observed = closure('2026-03-20');
    for (const fields of [
      { actualAt: observed.receivedAt + 300001 },
      { createdAt: observed.actualAt + 1 },
      { previousClosedAt: observed.actualAt + 1 },
      { receivedAt: observed.actualAt - 600000 },
    ]) {
      const value = { ...observed, ...fields };
      expect(nextTaskOccurrence(rule(), '2026-01-31', value)).toMatchObject({
        status: 'review',
        actualAt: value.actualAt,
      });
    }
    expect(
      nextTaskOccurrence(rule(), '2026-01-31', { ...observed, actualAt: observed.actualAt + 300000 }),
    ).toMatchObject({ status: 'ready' });
    expect(() => nextTaskOccurrence(rule(), 'bad', observed)).toThrow();
    for (const actualAt of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER])
      expect(() => nextTaskOccurrence(rule(), '2026-01-31', { ...observed, actualAt })).toThrow();
  });
});

describe('task recurrence contracts', () => {
  it.each([
    { interval: 0 },
    { interval: 1.5 },
    { interval: 1001 },
    { startDate: null },
    { startDate: '2026-02-29' },
    { time: '24:00' },
    { endDate: '2025-01-01' },
    { timezone: 'UTC' },
    { weekdays: [] },
    { unit: 'week', weekdays: [1, 1] },
    { unit: 'week', weekdays: [0] },
    { weekdays: [1] },
    { mode: 'after_completion', unit: 'week', weekdays: [1] },
    { unknown: true },
  ])('rejects invalid configuration %j', (fields) => {
    expect(taskRecurrenceRuleSchema.safeParse({ ...rule(), ...fields }).success).toBe(false);
    expect(() => firstTaskOccurrence({ ...rule(), ...fields } as TaskRecurrenceRule)).toThrow();
  });

  it('allows only shared relative template reminders and preserves legacy task patches', () => {
    const template = { title: 'Filtr', notes: null, assigneeId: null, reminders: [] };
    expect(taskSeriesTemplateSchema.safeParse(template).success).toBe(true);
    expect(
      taskSeriesTemplateSchema.safeParse({
        ...template,
        reminders: [{ type: 'absolute', remindAt: 1, audience: 'owner' }],
      }).success,
    ).toBe(false);
    expect(
      taskSeriesTemplateSchema.safeParse({
        ...template,
        reminders: [{ type: 'offset', offsetValue: 1, offsetUnit: 'day', audience: 'user' }],
      }).success,
    ).toBe(false);
    expect(patchTaskSchema.parse({ title: 'Nowy tytuł' })).toEqual({ title: 'Nowy tytuł' });
    expect(patchTaskSchema.safeParse({ recurrence: null }).success).toBe(false);
    const recurrence = taskSchema.shape.recurrence;
    expect(recurrence.parse(undefined)).toBeUndefined();
    expect(recurrence.parse(null)).toBeNull();
    expect(
      recurrence.safeParse({
        seriesId: crypto.randomUUID(),
        sequence: 0,
        plannedDate: '2026-03-20',
        plannedTime: null,
        state: 'skipped',
        closedAt: 1,
        closedBy: null,
        version: 0,
      }).success,
    ).toBe(true);
    expect(
      recurrence.safeParse({
        seriesId: crypto.randomUUID(),
        sequence: 0,
        plannedDate: '2026-03-20',
        plannedTime: null,
        state: 'active',
        closedAt: 1,
        closedBy: null,
        version: 0,
      }).success,
    ).toBe(false);
  });
});
