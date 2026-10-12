import { Temporal } from 'temporal-polyfill';
import { labels } from '../../i18n/pl.js';

export function distantCountdown(date: string, today: string, precision: 'day' | 'month'): string {
  const text = labels.calendarUi;
  const now = Temporal.PlainDate.from(today);
  const target = Temporal.PlainDate.from(date);
  if (precision === 'month' && date.slice(0, 7) === today.slice(0, 7)) return text.thisMonth;
  if (date <= today) return text.today;
  const difference = (precision === 'month' ? now.with({ day: 1 }) : now).until(target, { largestUnit: 'years' });
  const parts: string[] = [];
  if (difference.years) {
    const years = difference.years;
    const few = years % 10 >= 2 && years % 10 <= 4 && (years % 100 < 12 || years % 100 > 14);
    parts.push(`${years} ${years === 1 ? text.yearSingular : few ? text.yearsFew : text.yearsShort}`);
  }
  if (difference.months) parts.push(`${difference.months} ${text.monthsShort}`);
  if (!parts.length && precision === 'day')
    parts.push(`${difference.days} ${difference.days === 1 ? text.daySingular : text.daysPlural}`);
  return `${text.inFuture} ${parts.join(` ${text.and} `)}`;
}
