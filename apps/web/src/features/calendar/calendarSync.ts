import { Temporal } from 'temporal-polyfill';
import type { Reminder } from '@rodzina/shared';
import { apiFetch, ApiRequestError } from '../../api.js';
import { invalidateSessionRequests } from '../../platform.js';
import { calendarStore, monthsForRange, monthWindow } from './calendarOffline.js';
import { getEvent, listDistantEvents, listOccurrences, type CalendarRange } from './calendarApi.js';

const pending = new Map<string, Promise<unknown>>();
let running = 0;
const queue: (() => void)[] = [];
async function limited<T>(action: () => Promise<T>): Promise<T> {
  if (running >= 4) await new Promise<void>((resolve) => queue.push(resolve));
  else running++;
  try {
    return await action();
  } finally {
    const next = queue.shift();
    if (next) next();
    else running--;
  }
}
async function once<T>(key: string, token: number, action: () => Promise<T>): Promise<T> {
  const identity = `${token}:${key}`;
  if (pending.has(identity)) return pending.get(identity) as Promise<T>;
  const work = (async () => {
    if (!calendarStore.current(token)) throw new DOMException('Session changed', 'AbortError');
    try {
      const result = await action();
      if (!calendarStore.current(token)) throw new DOMException('Session changed', 'AbortError');
      return result;
    } catch (error) {
      if (calendarStore.current(token) && error instanceof ApiRequestError && [401, 403].includes(error.status)) {
        invalidateSessionRequests();
        window.dispatchEvent(new Event('rodzina:session-lost'));
      }
      throw error;
    }
  })();
  pending.set(identity, work);
  try {
    return await work;
  } finally {
    pending.delete(identity);
  }
}
export function fetchPersonal(id: string, token = calendarStore.token()) {
  return once(`personal:${id}`, token, async () => {
    const { reminders } = await limited(() =>
      apiFetch<{ reminders: Reminder[] }>(`/api/reminders/mine?${new URLSearchParams({ eventId: id })}`),
    );
    await calendarStore.savePersonal(id, reminders, token);
    return reminders;
  });
}
export function fetchSavedEvent(id: string, token = calendarStore.token()) {
  return once(`event:${id}`, token, async () => {
    try {
      const event = await limited(() => getEvent(id));
      await calendarStore.saveEvent(event, token);
      await fetchPersonal(id, token);
      return event;
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) await calendarStore.forgetEvent(id, token);
      throw error;
    }
  });
}
export function fetchSavedMonth(month: string, token = calendarStore.token(), since = Date.now()) {
  return once(`month:${month}`, token, async () => {
    const occurrences = await listOccurrences(monthWindow(month));
    await calendarStore.saveRange(month, occurrences, token);
    const results = await Promise.allSettled(
      [...new Set(occurrences.map((o) => o.eventId))].map((id) => {
        const saved = calendarStore.snapshot();
        return saved.details[id] && saved.details[id].syncedAt >= since && saved.personal[id]
          ? Promise.resolve(saved.details[id].event)
          : fetchSavedEvent(id, token);
      }),
    );
    const failure = results.find(
      (r) => r.status === 'rejected' && !(r.reason instanceof ApiRequestError && r.reason.status === 404),
    );
    if (failure?.status === 'rejected') throw failure.reason;
    return occurrences;
  });
}
export async function fetchSavedRange(range: CalendarRange) {
  const token = calendarStore.token();
  const since = Date.now();
  // A canonical month window includes the adjacent cells; avoid downloading extra months for those cells.
  const center = Temporal.PlainDate.from(range.from).add({
    days: Math.floor(Temporal.PlainDate.from(range.from).until(Temporal.PlainDate.from(range.to)).days / 2),
  });
  const month = center.toString().slice(0, 7);
  const window = monthWindow(month);
  const months = window.from <= range.from && window.to >= range.to ? [month] : monthsForRange(range);
  for (const value of months) await fetchSavedMonth(value, token, since);
  return true;
}
export function fetchSavedDistant(token = calendarStore.token()) {
  return once('distant', token, async () => {
    const events = await listDistantEvents();
    await calendarStore.saveDistant(events, token);
    await Promise.all(events.map((event) => fetchPersonal(event.id, token)));
    return events;
  });
}
