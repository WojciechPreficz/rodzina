import { z } from 'zod';
import { calendarDateSchema } from './events.js';
import { sharedTaskReminderSchema } from './reminders.js';

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const versionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const taskRecurrenceRuleSchema = z
  .object({
    mode: z.enum(['schedule', 'after_completion']),
    unit: z.enum(['day', 'week', 'month', 'year']),
    interval: z.number().int().min(1).max(1000),
    startDate: calendarDateSchema,
    time: timeSchema.nullable(),
    timezone: z.literal('Europe/Warsaw'),
    endDate: calendarDateSchema.nullable(),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (rule.endDate !== null && rule.endDate < rule.startDate)
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Koniec poprzedza początek serii.' });
    if (
      rule.weekdays &&
      (rule.mode !== 'schedule' || rule.unit !== 'week' || new Set(rule.weekdays).size !== rule.weekdays.length)
    )
      ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'Wybierz różne dni stałego rytmu tygodniowego.' });
  });

export const taskSeriesTemplateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    notes: z.string().trim().max(10000).nullable(),
    assigneeId: z.string().uuid().nullable(),
    reminders: z
      .array(sharedTaskReminderSchema)
      .max(20)
      .refine((items) => items.every((item) => item.type === 'offset'), {
        message: 'Wzorzec przechowuje tylko względne przypomnienia wspólne.',
      }),
  })
  .strict();

export const taskSeriesSchema = z.object({
  id: z.string().uuid(),
  listId: z.string().uuid(),
  rule: taskRecurrenceRuleSchema,
  template: taskSeriesTemplateSchema,
  state: z.enum(['active', 'stopped', 'ended']),
  version: versionSchema,
  createdBy: z.string().uuid().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});

export const taskOccurrenceSchema = z
  .object({
    seriesId: z.string().uuid(),
    seriesVersion: versionSchema.optional(),
    sequence: versionSchema,
    plannedDate: calendarDateSchema,
    plannedTime: timeSchema.nullable(),
    state: z.enum(['active', 'done', 'skipped']),
    closedAt: z.number().int().nonnegative().nullable(),
    closedBy: z.string().uuid().nullable(),
    version: versionSchema,
  })
  .superRefine((item, ctx) => {
    if ((item.state === 'active') !== (item.closedAt === null) || (item.state === 'active' && item.closedBy !== null))
      ctx.addIssue({ code: 'custom', message: 'Niepoprawne dane zamknięcia wystąpienia.' });
  });

export type TaskRecurrenceRule = z.infer<typeof taskRecurrenceRuleSchema>;
export type TaskSeriesTemplate = z.infer<typeof taskSeriesTemplateSchema>;
export type TaskSeries = z.infer<typeof taskSeriesSchema>;
export type TaskOccurrence = z.infer<typeof taskOccurrenceSchema>;

export const configureTaskSeriesSchema = z
  .object({
    rule: taskRecurrenceRuleSchema,
    template: taskSeriesTemplateSchema,
    expectedVersion: versionSchema,
    expectedOccurrenceVersion: versionSchema,
  })
  .strict();
export const taskSeriesVersionSchema = z
  .object({
    expectedVersion: versionSchema,
    expectedOccurrenceVersion: versionSchema,
  })
  .strict();
export const closeTaskOccurrenceSchema = z
  .object({
    expectedSeriesVersion: versionSchema,
    expectedOccurrenceVersion: versionSchema,
    closedAt: z.number().int().nonnegative().max(253402300799999),
  })
  .strict();
export const taskSeriesHistoryItemSchema = z.object({
  id: z.string().uuid(),
  seriesId: z.string().uuid(),
  taskId: z.string().uuid(),
  sequence: versionSchema,
  title: z.string(),
  plannedDate: calendarDateSchema,
  plannedTime: timeSchema.nullable(),
  state: z.enum(['done', 'skipped']),
  closedAt: z.number().int(),
  closedBy: z.string().uuid().nullable(),
  undoneAt: z.number().int().nullable(),
  undoneBy: z.string().uuid().nullable(),
});
export const taskSeriesResponseSchema = z.object({
  ok: z.literal(true),
  series: taskSeriesSchema,
  activeTaskId: z.string().uuid().nullable(),
  occurrenceVersion: versionSchema.nullable(),
});
export const taskSeriesHistoryResponseSchema = z.object({
  ok: z.literal(true),
  history: z.array(taskSeriesHistoryItemSchema),
});
export type ConfigureTaskSeries = z.infer<typeof configureTaskSeriesSchema>;
