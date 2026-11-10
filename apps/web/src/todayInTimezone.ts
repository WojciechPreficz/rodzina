import { Temporal } from 'temporal-polyfill';

export function todayInTimezone(timezone: string): string {
  return Temporal.Now.plainDateISO(timezone).toString();
}
