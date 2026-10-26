import { useSyncExternalStore } from 'react';
import { Temporal } from 'temporal-polyfill';
import { z } from 'zod';
import { registerAdapter } from '../../offline/registry.js';
import {
  activateOfflineAccount,
  accountToken,
  isAccountCurrent,
  readCache,
  writeCache,
  ensureMigrated,
} from '../../offline/database.js';
import { storageError } from '../../offline/status.js';
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
export const calendarSnapshotSchema = z.object({
  version: z.literal(1),
  account: z.string(),
  ranges: z.array(rangeSchema).max(12),
  details: z.record(z.string(), z.object({ event: eventSchema, syncedAt: z.number() })),
  personal: z.record(z.string(), z.array(reminderSchema)),
  distant: z.object({ ids: z.array(z.string()), syncedAt: z.number() }).optional(),
});
export type Snapshot = z.infer<typeof calendarSnapshotSchema>;
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
  private ready: Promise<void> = Promise.resolve();
  private writes: Promise<unknown> = Promise.resolve();
  activate(account: string) {
    if (this.value.account === account) return this.ready;
    this.epoch++;
    const token = this.epoch;
    const sessionToken = accountToken();
    this.value = empty(account);
    this.issue = undefined;
    this.ready = (async () => {
      try {
        await ensureMigrated();
        if (!this.current(token) || !isAccountCurrent(sessionToken)) return;
        await activateOfflineAccount(account);
        if (!this.current(token) || !isAccountCurrent(sessionToken)) return;
        const saved = await readCache('calendar', account);
        if (!this.current(token) || !isAccountCurrent(sessionToken)) return;
        if (saved) {
          if (saved.schemaVersion !== 1) throw new Error('Nieobsługiwana wersja kalendarza. Zaktualizuj aplikację.');
          this.value = parseCalendarSnapshot(saved.payload, account);
        }
      } catch (error) {
        if (this.current(token)) this.issue = `Nie można odczytać kalendarza. ${storageError(error)}`;
      }
      if (this.current(token)) this.emit();
    })();
    return this.ready;
  }
  clear(removeStored = true) {
    this.epoch++;
    this.value = empty('');
    this.issue = undefined;
    // The account registry owns durable deletion of the shared database.
    if (removeStored) {
      try {
        localStorage.removeItem(CALENDAR_STORAGE_KEY);
      } catch {
        this.issue = 'Nie można usunąć starego kalendarza z pamięci urządzenia.';
      }
    }
    this.emit();
  }
  private commit(update: (value: Snapshot) => Snapshot) {
    const token = this.epoch;
    const sessionToken = accountToken();
    const ready = this.ready;
    const work = this.writes.then(async () => {
      await ready;
      if (!this.current(token) || !isAccountCurrent(sessionToken)) return;
      let preview: Snapshot | undefined;
      try {
        preview = parseCalendarSnapshot(update(this.value), this.value.account);
        const saved = await writeCache('calendar', preview, sessionToken);
        if (!this.current(token) || !isAccountCurrent(sessionToken)) return;
        this.value = parseCalendarSnapshot(saved, this.value.account);
        this.issue = undefined;
      } catch (error) {
        if (this.current(token) && isAccountCurrent(sessionToken)) {
          // Downloaded data may remain visible in memory; it is never a second durable store.
          if (preview && !(error instanceof DOMException && error.name === 'AbortError')) this.value = preview;
          this.issue = `Nie można zapisać kalendarza na urządzeniu. ${storageError(error)} Nowy podgląd może być niedostępny po zamknięciu aplikacji.`;
        }
      }
      if (this.current(token)) this.emit();
    });
    this.writes = work;
    return work;
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
    return this.commit((value) =>
      this.prune({ ...value, ranges: [...value.ranges.filter((r) => r.month !== month), range] }),
    );
  }
  touch(range: CalendarRange) {
    const months = new Set(monthsForRange(range));
    if (!this.value.ranges.some((r) => months.has(r.month))) return;
    return this.commit((value) => ({
      ...value,
      ranges: value.ranges.map((r) => (months.has(r.month) ? { ...r, usedAt: Date.now() } : r)),
    }));
  }
  markStale() {
    return this.commit((value) => ({ ...value, ranges: value.ranges.map((r) => ({ ...r, stale: true })) }));
  }
  saveEvent(event: CalendarEvent, token: number) {
    if (!this.current(token) || event.familyId !== this.value.account.split(':')[0]) return;
    return this.commit((value) => {
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
      return this.prune({ ...value, ranges, details: { ...value.details, [event.id]: { event, syncedAt: now } } });
    });
  }

  savePersonal(id: string, reminders: Reminder[], token: number) {
    if (!this.current(token)) return;
    return this.commit((value) => ({ ...value, personal: { ...value.personal, [id]: reminders } }));
  }
  saveDistant(events: CalendarEvent[], token: number) {
    if (!this.current(token)) return;
    return this.commit((value) => {
      const now = Date.now();
      const details = { ...value.details };
      events.forEach((event) => {
        details[event.id] = { event, syncedAt: now };
      });
      return this.prune({ ...value, details, distant: { ids: events.map((e) => e.id), syncedAt: now } });
    });
  }

  forgetEvent(id: string, token: number) {
    if (!this.current(token)) return;
    return this.commit((value) => {
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
  }
}
export function parseCalendarSnapshot(input: unknown, account?: string): Snapshot {
  const data = calendarSnapshotSchema.parse(input);
  const [familyId, userId] = data.account.split(':');
  if (
    (account && data.account !== account) ||
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
registerAdapter({
  module: 'calendar',
  schemaVersion: 1,
  capabilities: 'read-only',
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
      coverage: !data.ranges.length ? 'missing' : data.ranges.every((range) => range.complete) ? 'complete' : 'partial',
    };
  },
  trim: (input, fits) => {
    const value = parseCalendarSnapshot(input);
    value.ranges.sort((a, b) => b.usedAt - a.usedAt);
    const prune = () => {
      const ids = new Set([
        ...value.ranges.flatMap((r) => [...r.detailIds, ...r.occurrences.map((o) => o.eventId)]),
        ...(value.distant?.ids ?? []),
      ]);
      value.details = Object.fromEntries(Object.entries(value.details).filter(([id]) => ids.has(id)));
      value.personal = Object.fromEntries(Object.entries(value.personal).filter(([id]) => id in value.details));
    };
    prune();
    while (!fits(value) && value.ranges.length) {
      value.ranges.pop();
      prune();
    }
    return value;
  },
});
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
