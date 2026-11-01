import { expect, it } from 'vitest';
import type { TaskRecurrenceRule } from '@rodzina/shared';
import { skippedTaskDates } from './taskRecurrencePreview.js';
const rule: TaskRecurrenceRule = {
  mode: 'schedule',
  unit: 'week',
  interval: 1,
  weekdays: [2],
  startDate: '2026-03-03',
  time: '15:00',
  timezone: 'Europe/Warsaw',
  endDate: null,
};
it('shows missed rhythm dates but excludes the active occurrence and future successor', () => {
  expect(skippedTaskDates(rule, '2026-03-03', Date.parse('2026-03-20T12:00Z'))).toEqual({
    dates: ['2026-03-10', '2026-03-17'],
    more: false,
  });
  expect(
    skippedTaskDates(
      { ...rule, mode: 'after_completion', weekdays: undefined },
      '2026-03-03',
      Date.parse('2026-03-20T12:00Z'),
    ).dates,
  ).toEqual([]);
});
it('bounds the list and respects the inclusive end date', () => {
  expect(skippedTaskDates(rule, '2026-03-03', Date.parse('2030-01-01T12:00Z'))).toMatchObject({
    dates: expect.any(Array),
    more: true,
  });
  expect(skippedTaskDates({ ...rule, endDate: '2026-03-10' }, '2026-03-03', Date.parse('2030-01-01T12:00Z'))).toEqual({
    dates: ['2026-03-10'],
    more: false,
  });
});
it('handles supported historical dates without attempting a negative closure timestamp', () => {
  expect(skippedTaskDates({ ...rule, startDate: '1900-01-01' }, '1900-01-02', Date.now())).toEqual({
    dates: [],
    more: true,
  });
});
