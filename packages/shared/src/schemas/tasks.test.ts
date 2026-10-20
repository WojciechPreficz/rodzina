import { describe, expect, it } from 'vitest';
import { createTaskSchema, patchTaskSchema, tasksQuerySchema } from './tasks.js';

describe('task request contracts', () => {
  it('accepts optional deadlines, leap dates and nullable fields and trims text', () => {
    expect(createTaskSchema.parse({ title: '  Zadanie  ', notes: '  Opis  ' })).toEqual({
      title: 'Zadanie',
      notes: 'Opis',
    });
    expect(createTaskSchema.safeParse({ title: 'Zadanie', dueDate: '2028-02-29', dueTime: '00:00' }).success).toBe(
      true,
    );
    expect(patchTaskSchema.safeParse({ notes: null, dueDate: null, dueTime: null, assigneeId: null }).success).toBe(
      true,
    );
  });

  it.each([
    { title: ' ' },
    { title: 'x'.repeat(201) },
    { dueDate: '2027-02-29' },
    { dueDate: '2028-04-31' },
    { dueDate: '01-05-2028' },
    { dueTime: '9:00' },
    { dueTime: '24:00' },
    { dueTime: '12:60' },
    { assigneeId: 'bad' },
    { doneBy: null },
    { doneAt: 1 },
    { createdBy: null },
    { reminders: [] },
  ])('rejects invalid or protected fields: %j', (fields) => {
    expect(createTaskSchema.safeParse({ title: 'Zadanie', ...fields }).success).toBe(false);
    expect(patchTaskSchema.safeParse(fields).success).toBe(false);
  });

  it('requires a date for a creation time and disallows empty patches or invalid positions', () => {
    expect(createTaskSchema.safeParse({ title: 'Zadanie', dueTime: '10:00' }).success).toBe(false);
    for (const fields of [{}, { position: -1 }, { position: 1.5 }, { position: 2147483648 }, { isDone: 1 }])
      expect(patchTaskSchema.safeParse(fields).success).toBe(false);
    expect(patchTaskSchema.safeParse({ dueTime: '10:00' }).success).toBe(true);
    expect(patchTaskSchema.safeParse({ isDone: false, position: 0 }).success).toBe(true);
  });

  it('defaults to open tasks and accepts only defined statuses', () => {
    expect(tasksQuerySchema.parse({})).toEqual({ status: 'open' });
    for (const status of ['open', 'done', 'all']) expect(tasksQuerySchema.parse({ status })).toEqual({ status });
    expect(tasksQuerySchema.safeParse({ status: 'other' }).success).toBe(false);
  });
});
