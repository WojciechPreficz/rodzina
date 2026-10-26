import { Temporal } from 'temporal-polyfill';
import type { CalendarEventExternal, CalendarType } from '@schedule-x/calendar';
import { labels } from '../../i18n/pl.js';
import type { HolidayCategory, PolishHoliday } from './polishHolidays.js';

export type HolidayLayers = Record<HolidayCategory, boolean>;
export const holidayLayersStorageKey = 'rodzina:calendar:holiday-layers:v1';
export const holidayColors: Record<HolidayCategory, string> = { publicHoliday: '#a63838', observance: '#6741a5' };

export function readHolidayLayers(): HolidayLayers {
  const defaults = { publicHoliday: true, observance: true };
  try {
    const value: unknown = JSON.parse(localStorage.getItem(holidayLayersStorageKey) ?? 'null');
    if (typeof value !== 'object' || value === null) return defaults;
    return {
      publicHoliday: 'publicHoliday' in value && typeof value.publicHoliday === 'boolean' ? value.publicHoliday : true,
      observance: 'observance' in value && typeof value.observance === 'boolean' ? value.observance : true,
    };
  } catch {
    return defaults;
  }
}

export function saveHolidayLayers(layers: HolidayLayers): void {
  try {
    localStorage.setItem(holidayLayersStorageKey, JSON.stringify(layers));
  } catch {
    // The current selection still works when device storage is unavailable.
  }
}

export function holidayCalendars(): Record<string, CalendarType> {
  return Object.fromEntries(
    Object.entries(holidayColors).map(([category, color]) => [
      `polish-${category}`,
      {
        label: labels.calendarUi.holidayCategories[category as HolidayCategory],
        colorName: `polish-${category}`,
        lightColors: { main: color, container: `color-mix(in srgb, ${color} 12%, #fffefa)`, onContainer: color },
        darkColors: { main: color, container: '#343a40', onContainer: '#ffffff' },
      },
    ]),
  );
}

export function holidaysToScheduleX(holidays: PolishHoliday[], layers: HolidayLayers): CalendarEventExternal[] {
  return holidays
    .filter((holiday) => layers[holiday.category])
    .map((holiday) => ({
      id: `polish-${holiday.key}-${holiday.date}`,
      title: `${holiday.name} · ${labels.calendarUi.holidayCategories[holiday.category]}`,
      start: Temporal.PlainDate.from(holiday.date),
      end: Temporal.PlainDate.from(holiday.date),
      calendarId: `polish-${holiday.category}`,
      memberColor: holidayColors[holiday.category],
      holiday,
    }));
}
