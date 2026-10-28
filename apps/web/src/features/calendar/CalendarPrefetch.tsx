import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Temporal } from 'temporal-polyfill';
import { calendarStore } from './calendarOffline.js';
import { fetchSavedDistant, fetchSavedMonth } from './calendarSync.js';
import { todayInTimezone } from './toScheduleX.js';

export function CalendarPrefetch({ confirmedAt, timezone }: { confirmedAt: number; timezone: string }) {
  const client = useQueryClient();
  useEffect(() => {
    let disposed = false;
    const token = calendarStore.token();
    const current = () => !disposed && calendarStore.current(token);
    calendarStore.markStale();
    void client.invalidateQueries({ queryKey: ['calendar'] });
    const prefetch = async () => {
      const since = Date.now();
      const date = Temporal.PlainDate.from(todayInTimezone(timezone));
      for (const offset of [0, -1, 1]) {
        if (!current()) return;
        try {
          await fetchSavedMonth(date.add({ months: offset }).toString().slice(0, 7), token, since);
        } catch {
          if (!current()) return;
        }
      }
      if (current()) await fetchSavedDistant(token);
    };
    void prefetch().catch(() => {
      /* Query hooks surface errors; keep the last saved preview. */
    });
    return () => {
      disposed = true;
    };
  }, [client, confirmedAt, timezone]);
  return null;
}
