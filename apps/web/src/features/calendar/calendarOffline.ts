import { Temporal } from 'temporal-polyfill';
import { z } from 'zod';
import { registerOfflineModule, useOfflineModule } from '../../offline/moduleStore.js';
import { useMe } from '../../sessionContext.js';
import {
  eventSchema,
  calendarDateSchema,
  reminderSchema,
  occurrencesResponseSchema,
  localDateTimeToUtc,
  type CalendarEvent,
  type Reminder,
} from '@rodzina/shared';
import type { CalendarOccurrence, CalendarRange } from './calendarApi.js';
import { monthRange } from './toScheduleX.js';

export const CALENDAR_STORAGE_KEY = 'rodzina:calendar:v1';
const rangeSchema = z
  .object({
    month: z.string().regex(/^\d{4}-\d{2}$/),
    from: calendarDateSchema,
    to: calendarDateSchema,
    occurrences: occurrencesResponseSchema.shape.occurrences,
    detailIds: z.array(z.string()).default([]),
    complete: z.boolean(),
    stale: z.boolean(),
    syncedAt: z.number(),
    usedAt: z.number(),
  })
  .refine((range) => {
    try {
      const expected = monthWindow(range.month);
      return range.from === expected.from && range.to === expected.to;
    } catch {
      return false;
    }
  });
const calendarSnapshotSchema = z.object({
  version: z.literal(1),
  account: z.string(),
  ranges: z.array(rangeSchema).max(12),
  details: z.record(z.string(), z.object({ event: eventSchema, syncedAt: z.number() })),
  personal: z.record(z.string(), z.array(reminderSchema)),
  distant: z.object({ ids: z.array(z.string()), syncedAt: z.number() }).optional(),
});
export type Snapshot = z.infer<typeof calendarSnapshotSchema>;
const empty = (account: string): Snapshot => ({ version: 1, account, ranges: [], details: {}, personal: {} });

export function monthsForRange(range: CalendarRange): string[] {
  const months: string[] = [];
  let date = Temporal.PlainDate.from(range.from).with({ day: 1 });
  const end = Temporal.PlainDate.from(range.to).with({ day: 1 });
  while (Temporal.PlainDate.compare(date, end) <= 0) {
    months.push(date.toString().slice(0, 7));
    date = date.add({ months: 1 });
  }
  return months;
}
export const monthWindow = (month: string) => monthRange(`${month}-01`);
const nextDay = (date: string) => Temporal.PlainDate.from(date).add({ days: 1 }).toString();
function overlaps(item: CalendarOccurrence, range: CalendarRange, timezone: string) {
  return (
    item.startUtc < localDateTimeToUtc(nextDay(range.to), '00:00', timezone) &&
    item.endUtc > localDateTimeToUtc(range.from, '00:00', timezone)
  );
}

function parseCalendarSnapshot(input: unknown): Snapshot {
  const data = calendarSnapshotSchema.parse(input);
  const [familyId, userId] = data.account.split(':');
  if (
    !familyId ||
    !userId ||
    Object.entries(data.details).some(([id, { event }]) => id !== event.id || event.familyId !== familyId) ||
    Object.entries(data.personal).some(([id, reminders]) =>
      reminders.some((r) => r.familyId !== familyId || r.userId !== userId || r.eventId !== id),
    )
  )
    throw new Error('Dane kalendarza należą do innego konta.');
  return data;
}
const calendarModule = registerOfflineModule({
  mode: 'read-only',
  cache: {
    module: 'calendar',
    schemaVersion: 1,
    legacyKey: CALENDAR_STORAGE_KEY,
    budget: 10 * 1048576,
    parseCache: parseCalendarSnapshot,
    describe: (input) => {
      const data = parseCalendarSnapshot(input);
      const timestamps = [
        ...data.ranges.map((range) => range.syncedAt),
        ...(data.distant ? [data.distant.syncedAt] : []),
      ].filter((time) => time > 0);
      return {
        syncedAt: timestamps.length ? Math.min(...timestamps) : null,
        coverage: !data.ranges.length
          ? 'missing'
          : data.ranges.every((range) => range.complete)
            ? 'complete'
            : 'partial',
      };
    },
    trim: (input, fits) => {
      const value = parseCalendarSnapshot(input);
      value.ranges.sort((a, b) => b.usedAt - a.usedAt);
      pruneDetails(value);
      while (!fits(value) && value.ranges.length) {
        value.ranges.pop();
        pruneDetails(value);
      }
      return value;
    },
  },
  project: (snapshot: Snapshot) => snapshot,
  readError: (detail) => `Nie można odczytać kalendarza. ${detail}`,
  writeError: (detail) =>
    `Nie można zapisać kalendarza na urządzeniu. ${detail} Nowy podgląd może być niedostępny po zamknięciu aplikacji.`,
});

function pruneDetails(value: Snapshot) {
  const ids = new Set([
    ...value.ranges.flatMap((r) => [...r.detailIds, ...r.occurrences.map((o) => o.eventId)]),
    ...(value.distant?.ids ?? []),
  ]);
  value.details = Object.fromEntries(Object.entries(value.details).filter(([id]) => ids.has(id)));
  value.personal = Object.fromEntries(Object.entries(value.personal).filter(([id]) => id in value.details));
}

function limitRanges(value: Snapshot) {
  value.ranges = [...value.ranges].sort((a, b) => b.usedAt - a.usedAt).slice(0, 12);
  pruneDetails(value);
  return value;
}

export function createCalendarStore() {
  const store = calendarModule.createStore();
  const commit = (token: number, update: (value: Snapshot) => Snapshot) =>
    store.updateSnapshot(token, (account, saved) => update(saved ?? empty(account)));

  return {
    ...store,
    saveRange(month: string, occurrences: CalendarOccurrence[], token: number) {
      const now = Date.now();
      const range = {
        month,
        ...monthWindow(month),
        occurrences,
        detailIds: [],
        complete: true,
        stale: false,
        syncedAt: now,
        usedAt: now,
      };
      return commit(token, (value) =>
        limitRanges({ ...value, ranges: [...value.ranges.filter((r) => r.month !== month), range] }),
      );
    },
    touch(range: CalendarRange) {
      const months = new Set(monthsForRange(range));
      if (!store.snapshot().view?.ranges.some((r) => months.has(r.month))) return;
      return commit(store.token(), (value) => ({
        ...value,
        ranges: value.ranges.map((r) => (months.has(r.month) ? { ...r, usedAt: Date.now() } : r)),
      }));
    },
    markStale() {
      return commit(store.token(), (value) => ({ ...value, ranges: value.ranges.map((r) => ({ ...r, stale: true })) }));
    },
    saveEvent(event: CalendarEvent, token: number) {
      if (event.familyId !== store.snapshot().account.split(':')[0]) return;
      return commit(token, (value) => {
        const month = event.startDate.slice(0, 7);
        const now = Date.now();
        const linked =
          value.ranges.some((r) => r.occurrences.some((o) => o.eventId === event.id)) ||
          value.distant?.ids.includes(event.id);
        const ranges = linked
          ? value.ranges
          : value.ranges.some((r) => r.month === month)
            ? value.ranges.map((r) =>
                r.month === month ? { ...r, detailIds: [...new Set([...r.detailIds, event.id])], usedAt: now } : r,
              )
            : [
                ...value.ranges,
                {
                  month,
                  ...monthWindow(month),
                  occurrences: [],
                  detailIds: [event.id],
                  complete: false,
                  stale: true,
                  syncedAt: 0,
                  usedAt: now,
                },
              ];
        return limitRanges({ ...value, ranges, details: { ...value.details, [event.id]: { event, syncedAt: now } } });
      });
    },

    savePersonal(id: string, reminders: Reminder[], token: number) {
      return commit(token, (value) => ({ ...value, personal: { ...value.personal, [id]: reminders } }));
    },
    saveDistant(events: CalendarEvent[], token: number) {
      return commit(token, (value) => {
        const now = Date.now();
        const details = { ...value.details };
        events.forEach((event) => {
          details[event.id] = { event, syncedAt: now };
        });
        return limitRanges({ ...value, details, distant: { ids: events.map((e) => e.id), syncedAt: now } });
      });
    },

    forgetEvent(id: string, token: number) {
      return commit(token, (value) => {
        const details = { ...value.details };
        const personal = { ...value.personal };
        delete details[id];
        delete personal[id];
        return {
          ...value,
          details,
          personal,
          ...(value.distant ? { distant: { ...value.distant, ids: value.distant.ids.filter((v) => v !== id) } } : {}),
          ranges: value.ranges.map((r) =>
            r.occurrences.some((o) => o.eventId === id) || r.detailIds.includes(id)
              ? {
                  ...r,
                  complete: false,
                  stale: true,
                  detailIds: r.detailIds.filter((v) => v !== id),
                  occurrences: r.occurrences.filter((o) => o.eventId !== id),
                }
              : r,
          ),
        };
      });
    },
  };
}
export const calendarStore = createCalendarStore();
export const registerCalendarStore = () => calendarModule.registerStore(calendarStore);

export function useCalendarOffline() {
  const { family, user } = useMe();
  return useOfflineModule(calendarStore, family && user ? `${family.id}:${user.id}` : '');
}

export function readCalendarRange(snapshot: Snapshot | undefined, range: CalendarRange, timezone: string) {
  const ranges = (snapshot?.ranges ?? [])
    .filter((r) => r.to >= range.from && r.from <= range.to)
    .sort((a, b) => a.syncedAt - b.syncedAt);
  let data: CalendarOccurrence[] = [];
  for (const saved of ranges) {
    if (saved.complete) data = data.filter((o) => !overlaps(o, saved, timezone));
    data.push(...saved.occurrences);
  }
  const unique = new Map(
    data.filter((o) => overlaps(o, range, timezone)).map((o) => [`${o.eventId}:${o.occurrenceDate}`, o]),
  );
  let cursor = range.from;
  for (const saved of ranges.filter((r) => r.complete).sort((a, b) => a.from.localeCompare(b.from))) {
    if (saved.from <= cursor && saved.to >= cursor) cursor = nextDay(saved.to);
  }
  const timestamps = ranges.filter((r) => r.syncedAt > 0).map((r) => r.syncedAt);
  return {
    data: [...unique.values()],
    coverage: cursor > range.to ? ('complete' as const) : ranges.length ? ('partial' as const) : ('missing' as const),
    syncedAt: timestamps.length ? Math.min(...timestamps) : undefined,
  };
}
