import { Temporal } from 'temporal-polyfill';
import type { CalendarRange } from './calendarApi.js';

export type HolidayCategory = 'publicHoliday' | 'observance';
export type PolishHoliday = { key: string; name: string; date: string; category: HolidayCategory };
export const firstHolidayYear = 2025;
export const lastHolidayYear = 2099;

// Current Polish rules, including Christmas Eve since 2025. Sources: docs/DECISIONS.md.
const fixedHolidays = [
  ['new-year', '01-01', 'Nowy Rok'],
  ['epiphany', '01-06', 'Święto Trzech Króli'],
  ['labour-day', '05-01', 'Święto Pracy'],
  ['constitution-day', '05-03', 'Święto Narodowe Trzeciego Maja'],
  ['assumption', '08-15', 'Wniebowzięcie Najświętszej Maryi Panny'],
  ['all-saints', '11-01', 'Wszystkich Świętych'],
  ['independence-day', '11-11', 'Dzień Niepodległości'],
  ['christmas-eve', '12-24', 'Wigilia Bożego Narodzenia'],
  ['christmas', '12-25', 'Pierwszy dzień Bożego Narodzenia'],
  ['boxing-day', '12-26', 'Drugi dzień Bożego Narodzenia'],
] as const;

const observances = [
  ['grandmothers-day', '01-21', 'Dzień Babci'],
  ['grandfathers-day', '01-22', 'Dzień Dziadka'],
  ['valentines-day', '02-14', 'Walentynki'],
  ['womens-day', '03-08', 'Dzień Kobiet'],
  ['mens-day', '03-10', 'Dzień Mężczyzn'],
  ['mothers-day', '05-26', 'Dzień Matki'],
  ['childrens-day', '06-01', 'Dzień Dziecka'],
  ['fathers-day', '06-23', 'Dzień Ojca'],
  ['boys-day', '09-30', 'Dzień Chłopaka'],
  ['teachers-day', '10-14', 'Dzień Edukacji Narodowej (Dzień Nauczyciela)'],
  ['saint-nicholas-day', '12-06', 'Mikołajki'],
  ['new-years-eve', '12-31', 'Sylwester'],
] as const;

// Gregorian Easter (Meeus/Jones/Butcher), calculated without instants or time zones.
function easterSunday(year: number): Temporal.PlainDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const base = h + l - 7 * m + 114;
  return Temporal.PlainDate.from({ year, month: Math.floor(base / 31), day: (base % 31) + 1 });
}

export function polishHolidaysForYear(year: number): PolishHoliday[] {
  if (!Number.isInteger(year) || year < firstHolidayYear || year > lastHolidayYear) return [];
  const fixed = (entries: ReadonlyArray<readonly [string, string, string]>, category: HolidayCategory) =>
    entries.map(([key, date, name]) => ({ key, name, date: `${year}-${date}`, category }));
  const easter = easterSunday(year);
  const movableRules: ReadonlyArray<readonly [string, number, string]> = [
    ['easter', 0, 'Pierwszy dzień Wielkiej Nocy'],
    ['easter-monday', 1, 'Drugi dzień Wielkiej Nocy'],
    ['pentecost', 49, 'Pierwszy dzień Zielonych Świątek'],
    ['corpus-christi', 60, 'Boże Ciało'],
  ];
  const movable: PolishHoliday[] = movableRules.map(([key, days, name]) => ({
    key,
    name,
    date: easter.add({ days }).toString(),
    category: 'publicHoliday',
  }));
  return [...fixed(fixedHolidays, 'publicHoliday'), ...movable, ...fixed(observances, 'observance')].sort(
    (a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key),
  );
}

export function polishHolidaysInRange({ from, to }: CalendarRange): PolishHoliday[] {
  const start = Temporal.PlainDate.from(from);
  const end = Temporal.PlainDate.from(to);
  if (Temporal.PlainDate.compare(start, end) > 0) return [];
  const result: PolishHoliday[] = [];
  for (let year = Math.max(start.year, firstHolidayYear); year <= Math.min(end.year, lastHolidayYear); year++) {
    result.push(...polishHolidaysForYear(year).filter((holiday) => holiday.date >= from && holiday.date <= to));
  }
  return result;
}

export function isHolidayRangeSupported({ from, to }: CalendarRange): boolean {
  return Temporal.PlainDate.from(from).year >= firstHolidayYear && Temporal.PlainDate.from(to).year <= lastHolidayYear;
}
