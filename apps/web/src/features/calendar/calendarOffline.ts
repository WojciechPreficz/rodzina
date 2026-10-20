import { useSyncExternalStore } from 'react';
import { Temporal } from 'temporal-polyfill';
import { z } from 'zod';
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
const snapshotSchema = z.object({
  version: z.literal(1),
  account: z.string(),
  ranges: z.array(rangeSchema).max(12),
  details: z.record(z.string(), z.object({ event: eventSchema, syncedAt: z.number() })),
  personal: z.record(z.string(), z.array(reminderSchema)),
  distant: z.object({ ids: z.array(z.string()), syncedAt: z.number() }).optional(),
});
type Snapshot = z.infer<typeof snapshotSchema>;
export type SavedRange = z.infer<typeof rangeSchema>;
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

export class CalendarOfflineStore {
  private value = empty('');
  private epoch = 0;
  private listeners = new Set<() => void>();
  issue: string | undefined;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  snapshot = () => this.value;
  token = () => this.epoch;
  current = (token: number) => token === this.epoch && !!this.value.account;
  private emit() {
    this.listeners.forEach((listener) => listener());
  }
  activate(account: string) {
    if (this.value.account === account) return;
    this.epoch++;
    this.value = empty(account);
    this.issue = undefined;
    try {
      const raw = localStorage.getItem(CALENDAR_STORAGE_KEY);
      if (raw) {
        const data = snapshotSchema.parse(JSON.parse(raw));
        const [familyId, userId] = account.split(':');
        if (
          data.account === account &&
          Object.values(data.details).every(({ event }) => event.familyId === familyId) &&
          Object.values(data.personal)
            .flat()
            .every((r) => r.familyId === familyId && r.userId === userId)
        ) {
          this.value = data;
        } else localStorage.removeItem(CALENDAR_STORAGE_KEY);
      }
    } catch {
      this.issue =
        'Nie można odczytać kalendarza z pamięci urządzenia. Połącz się z internetem, aby pobrać go ponownie.';
    }
    this.emit();
  }
  clear(removeStored = true) {
    this.epoch++;
    this.value = empty('');
    this.issue = undefined;
    try {
      if (removeStored) localStorage.removeItem(CALENDAR_STORAGE_KEY);
    } catch {
      this.issue = 'Nie można usunąć kalendarza z pamięci urządzenia. Włącz dostęp do pamięci i wyloguj się ponownie.';
    }
    this.emit();
  }
  private commit(value: Snapshot) {
    this.value = value;
    try {
      localStorage.setItem(CALENDAR_STORAGE_KEY, JSON.stringify(value));
      this.issue = undefined;
    } catch {
      this.issue =
        'Nie można zapisać kalendarza na urządzeniu. Zwolnij miejsce lub włącz pamięć przeglądarki. Dane mogą być niedostępne po zamknięciu aplikacji.';
    }
    this.emit();
  }
  private prune(value: Snapshot) {
    value.ranges = [...value.ranges].sort((a, b) => b.usedAt - a.usedAt).slice(0, 12);
    const ids = new Set([
      ...value.ranges.flatMap((r) => [...r.detailIds, ...r.occurrences.map((o) => o.eventId)]),
      ...(value.distant?.ids ?? []),
    ]);
    value.details = Object.fromEntries(Object.entries(value.details).filter(([id]) => ids.has(id)));
    value.personal = Object.fromEntries(Object.entries(value.personal).filter(([id]) => id in value.details));
    return value;
  }
  saveRange(month: string, occurrences: CalendarOccurrence[], token: number) {
    if (!this.current(token)) return;
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
    this.commit(this.prune({ ...this.value, ranges: [...this.value.ranges.filter((r) => r.month !== month), range] }));
  }
  touch(range: CalendarRange) {
    const months = new Set(monthsForRange(range));
    if (!this.value.ranges.some((r) => months.has(r.month))) return;
    this.commit({
      ...this.value,
      ranges: this.value.ranges.map((r) => (months.has(r.month) ? { ...r, usedAt: Date.now() } : r)),
    });
  }
  markStale() {
    this.commit({ ...this.value, ranges: this.value.ranges.map((r) => ({ ...r, stale: true })) });
  }
  saveEvent(event: CalendarEvent, token: number) {
    if (!this.current(token) || event.familyId !== this.value.account.split(':')[0]) return;
    const month = event.startDate.slice(0, 7);
    const now = Date.now();
    const linked =
      this.value.ranges.some((r) => r.occurrences.some((o) => o.eventId === event.id)) ||
      this.value.distant?.ids.includes(event.id);
    const ranges = linked
      ? this.value.ranges
      : this.value.ranges.some((r) => r.month === month)
        ? this.value.ranges.map((r) =>
            r.month === month ? { ...r, detailIds: [...new Set([...r.detailIds, event.id])], usedAt: now } : r,
          )
        : [
            ...this.value.ranges,
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
    this.commit(
      this.prune({ ...this.value, ranges, details: { ...this.value.details, [event.id]: { event, syncedAt: now } } }),
    );
  }
  savePersonal(id: string, reminders: Reminder[], token: number) {
    if (!this.current(token)) return;
    this.commit({ ...this.value, personal: { ...this.value.personal, [id]: reminders } });
  }
  saveDistant(events: CalendarEvent[], token: number) {
    if (!this.current(token)) return;
    const now = Date.now();
    const details = { ...this.value.details };
    events.forEach((event) => {
      details[event.id] = { event, syncedAt: now };
    });
    this.commit(this.prune({ ...this.value, details, distant: { ids: events.map((e) => e.id), syncedAt: now } }));
  }
  forgetEvent(id: string, token: number) {
    if (!this.current(token)) return;
    const details = { ...this.value.details };
    const personal = { ...this.value.personal };
    delete details[id];
    delete personal[id];
    this.commit({
      ...this.value,
      details,
      personal,
      ...(this.value.distant
        ? { distant: { ...this.value.distant, ids: this.value.distant.ids.filter((v) => v !== id) } }
        : {}),
      ranges: this.value.ranges.map((r) =>
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
    });
  }
}
export const calendarStore = new CalendarOfflineStore();
export const useCalendarSnapshot = () => useSyncExternalStore(calendarStore.subscribe, calendarStore.snapshot);

export function readCalendarRange(snapshot: Snapshot, range: CalendarRange, timezone: string) {
  const ranges = snapshot.ranges
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
