import { z } from 'zod';
import * as rrule from 'rrule';
import { reminderSchema, sharedEventReminderSchema } from './reminders.js';

const { RRule } = (Reflect.get(rrule, 'default') as typeof rrule | undefined) ?? rrule;

export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= '0100-01-01';
  }, 'Niepoprawna data.');

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const recurrenceSchema = z
  .string()
  .min(1)
  .max(2000)
  .refine((value) => {
    try {
      // Only date-based rules: the API identifies each occurrence by its local date.
      if (/[\r\n]/.test(value)) return false;
      const parts = value.replace(/^RRULE:/, '').split(';');
      const keys = parts.map((part) => part.split('=')[0]);
      if (new Set(keys).size !== keys.length) return false;
      if (!parts.some((part) => /^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)$/.test(part))) return false;
      if (parts.some((part) => !/^[A-Z]+=[^=]+$/.test(part))) return false;
      if (
        keys.some(
          (key) =>
            ![
              'FREQ',
              'INTERVAL',
              'COUNT',
              'UNTIL',
              'BYDAY',
              'BYMONTHDAY',
              'BYMONTH',
              'BYYEARDAY',
              'BYWEEKNO',
              'BYSETPOS',
              'WKST',
            ].includes(key ?? ''),
        )
      )
        return false;
      for (const key of ['INTERVAL', 'COUNT']) {
        const raw = parts.find((part) => part.startsWith(`${key}=`))?.slice(key.length + 1);
        if (raw !== undefined && (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1))
          return false;
      }
      const weekdays = parts.find((part) => part.startsWith('BYDAY='))?.slice(6);
      if (
        weekdays !== undefined &&
        weekdays.split(',').some((day) => {
          const match = /^([+-]?[1-9]\d?)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(day);
          return (
            !match ||
            (match[1] !== undefined &&
              (Math.abs(Number(match[1])) > 53 || parts.includes('FREQ=DAILY') || parts.includes('FREQ=WEEKLY')))
          );
        })
      )
        return false;
      const weekStart = parts.find((part) => part.startsWith('WKST='))?.slice(5);
      if (weekStart !== undefined && !/^(MO|TU|WE|TH|FR|SA|SU)$/.test(weekStart)) return false;
      const options = RRule.parseString(value);
      if (options.count != null && options.until != null) return false;
      if (options.interval != null && (!Number.isSafeInteger(options.interval) || options.interval < 1)) return false;
      if (options.count != null && (!Number.isSafeInteger(options.count) || options.count < 1)) return false;
      const until = parts.find((part) => part.startsWith('UNTIL='))?.slice(6);
      if (until) {
        if (!/^\d{8}(T\d{6}Z?)?$/.test(until)) return false;
        const date = `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}`;
        if (!calendarDateSchema.safeParse(date).success) return false;
        if (
          until.length > 8 &&
          (!timeSchema.safeParse(`${until.slice(9, 11)}:${until.slice(11, 13)}`).success ||
            Number(until.slice(13, 15)) > 59)
        )
          return false;
      }
      for (const [key, low, high] of [
        ['BYMONTH', 1, 12],
        ['BYMONTHDAY', -31, 31],
        ['BYYEARDAY', -366, 366],
        ['BYWEEKNO', -53, 53],
        ['BYSETPOS', -366, 366],
      ] as const) {
        const raw = parts.find((part) => part.startsWith(`${key}=`))?.slice(key.length + 1);
        if (
          raw &&
          raw
            .split(',')
            .some((item) => !/^-?\d+$/.test(item) || Number(item) === 0 || Number(item) < low || Number(item) > high)
        )
          return false;
      }
      new RRule(options);
      return true;
    } catch {
      return false;
    }
  }, 'Niepoprawna reguła powtarzania.');

const eventFields = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(10000).nullable(),
    location: z.string().trim().max(500).nullable(),
    startDate: calendarDateSchema,
    startTime: timeSchema.nullable(),
    durationMinutes: z.number().int().positive().max(525600).nullable(),
    datePrecision: z.enum(['day', 'month']),
    rrule: recurrenceSchema.nullable(),
    kind: z.enum(['single', 'recurring', 'distant']),
    participantIds: z
      .array(z.string().uuid())
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, 'Uczestnicy nie mogą się powtarzać.'),
    reminders: z.array(sharedEventReminderSchema).max(100).optional(),
  })
  .strict();

function validateEvent(event: z.infer<typeof eventFields>, ctx: z.RefinementCtx) {
  if ((event.kind === 'recurring') !== (event.rrule !== null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['rrule'],
      message: 'Reguła powtarzania jest wymagana wyłącznie dla wydarzenia cyklicznego.',
    });
  }
  if (event.kind !== 'distant' && event.datePrecision !== 'day') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['datePrecision'],
      message: 'To wydarzenie wymaga dokładnej daty.',
    });
  }
  if (
    event.datePrecision === 'month' &&
    (!event.startDate.endsWith('-01') || event.startTime !== null || event.durationMinutes !== null)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['startDate'],
      message: 'Termin miesięczny wymaga pierwszego dnia miesiąca i nie może mieć godziny ani czasu trwania.',
    });
  }
  if (
    (event.startTime !== null && event.durationMinutes === null) ||
    (event.startTime === null &&
      event.durationMinutes !== null &&
      (event.kind !== 'single' || event.durationMinutes % 1440 !== 0))
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['durationMinutes'],
      message: 'Wydarzenie z godziną wymaga czasu trwania; całodniowe jednorazowe może trwać pełną liczbę dni.',
    });
  }
}

export const eventDataSchema = eventFields.superRefine(validateEvent);
export const createEventSchema = eventFields
  .extend({
    description: eventFields.shape.description.default(null),
    location: eventFields.shape.location.default(null),
    startTime: eventFields.shape.startTime.default(null),
    durationMinutes: eventFields.shape.durationMinutes.default(null),
    datePrecision: eventFields.shape.datePrecision.default('day'),
    rrule: eventFields.shape.rrule.default(null),
    participantIds: eventFields.shape.participantIds.default([]),
  })
  .superRefine(validateEvent);
export const patchEventSchema = eventFields
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Podaj zmiany wydarzenia.');
export const eventScopeSchema = z
  .object({ scope: z.enum(['all', 'this', 'following']).default('all'), occurrenceDate: calendarDateSchema.optional() })
  .strict()
  .refine((value) => value.scope === 'all' || value.occurrenceDate !== undefined, 'Podaj datę wystąpienia.');
export type EventScope = z.infer<typeof eventScopeSchema>;
export const occurrencesQuerySchema = z
  .object({
    from: calendarDateSchema,
    to: calendarDateSchema,
    userId: z.string().uuid().optional(),
  })
  .strict()
  .refine(({ from, to }) => {
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
    return days >= 0 && days < 62;
  }, 'Zakres musi obejmować od 1 do 62 dni.');

export const eventParticipantSchema = z.object({ id: z.string().uuid(), displayName: z.string(), color: z.string() });
export const eventExceptionSchema = z.object({
  id: z.string().uuid(),
  eventId: z.string().uuid(),
  originalDate: calendarDateSchema,
  isCancelled: z.boolean(),
  overrideStartDate: calendarDateSchema.nullable(),
  overrideStartTime: timeSchema.nullable(),
  overrideDurationMinutes: z.number().int().positive().nullable(),
  overrideTitle: z.string().nullable(),
});
export const eventSchema = eventFields.omit({ participantIds: true }).extend({
  id: z.string().uuid(),
  familyId: z.string().uuid(),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  participants: z.array(eventParticipantSchema),
  reminders: z.array(reminderSchema),
  exceptions: z.array(eventExceptionSchema),
});
export const eventResponseSchema = z.object({ ok: z.literal(true), event: eventSchema });
export const distantEventsResponseSchema = z.object({ ok: z.literal(true), events: z.array(eventSchema) });
export const occurrencesResponseSchema = z.object({
  ok: z.literal(true),
  occurrences: z.array(
    z.object({
      eventId: z.string().uuid(),
      occurrenceDate: calendarDateSchema,
      startUtc: z.number().int(),
      endUtc: z.number().int(),
      allDay: z.boolean(),
      isException: z.boolean(),
      title: z.string(),
      location: z.string().nullable(),
      kind: z.enum(['single', 'recurring', 'distant']),
      createdBy: z.string().uuid().nullable(),
      participants: z.array(eventParticipantSchema),
    }),
  ),
});
export const deleteEventResponseSchema = z.object({ ok: z.literal(true), deleted: z.literal(true) });

export type EventData = z.infer<typeof eventDataSchema>;
export type EventPatch = z.infer<typeof patchEventSchema>;
export type CalendarEvent = z.infer<typeof eventSchema>;
