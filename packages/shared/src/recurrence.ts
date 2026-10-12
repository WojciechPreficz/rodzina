import { calendarDateSchema } from './schemas/events.js';

export const wizardWeekdays = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type WizardWeekday = (typeof wizardWeekdays)[number];
export type RecurrenceWizard = {
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  weekdays: WizardWeekday[];
  ending: { type: 'never' } | { type: 'until'; date: string } | { type: 'count'; count: number };
};

export function defaultRecurrenceWizard(startDate: string): RecurrenceWizard {
  calendarDateSchema.parse(startDate);
  const day = new Date(`${startDate}T00:00:00Z`).getUTCDay();
  return { frequency: 'WEEKLY', interval: 1, weekdays: [wizardWeekdays[(day + 6) % 7]!], ending: { type: 'never' } };
}

export function rruleFromWizard(wizard: RecurrenceWizard): string {
  if (
    !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(wizard.frequency) ||
    !Number.isSafeInteger(wizard.interval) ||
    wizard.interval < 1
  )
    throw new RangeError('Invalid recurrence interval');
  const parts = [`FREQ=${wizard.frequency}`, `INTERVAL=${wizard.interval}`, 'WKST=MO'];
  if (wizard.frequency === 'WEEKLY') {
    if (!wizard.weekdays.length || wizard.weekdays.some((day) => !wizardWeekdays.includes(day)))
      throw new RangeError('Select weekdays');
    parts.push(`BYDAY=${wizardWeekdays.filter((day) => wizard.weekdays.includes(day)).join(',')}`);
  }
  if (wizard.ending.type === 'until') {
    calendarDateSchema.parse(wizard.ending.date);
    parts.push(`UNTIL=${wizard.ending.date.replaceAll('-', '')}T235959`);
  } else if (wizard.ending.type === 'count') {
    if (!Number.isSafeInteger(wizard.ending.count) || wizard.ending.count < 1)
      throw new RangeError('Invalid recurrence count');
    parts.push(`COUNT=${wizard.ending.count}`);
  }
  return parts.join(';');
}

/** Return null for rules the wizard cannot represent, so editing never silently changes them. */
export function wizardFromRrule(rule: string, startDate: string): RecurrenceWizard | null {
  const entries = rule
    .replace(/^RRULE:/, '')
    .split(';')
    .map((part) => part.split('='));
  if (
    entries.some(
      ([key, value]) => !value || !['FREQ', 'INTERVAL', 'WKST', 'BYDAY', 'UNTIL', 'COUNT'].includes(key ?? ''),
    ) ||
    new Set(entries.map(([key]) => key)).size !== entries.length
  )
    return null;
  const fields = Object.fromEntries(entries) as Record<string, string>;
  const frequency = fields.FREQ as RecurrenceWizard['frequency'];
  if (
    !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(frequency) ||
    (fields.WKST && fields.WKST !== 'MO') ||
    (fields.COUNT && fields.UNTIL) ||
    (fields.BYDAY && frequency !== 'WEEKLY')
  )
    return null;
  try {
    const wizard = defaultRecurrenceWizard(startDate);
    wizard.frequency = frequency;
    wizard.interval = fields.INTERVAL ? Number(fields.INTERVAL) : 1;
    wizard.weekdays =
      frequency === 'WEEKLY' ? (fields.BYDAY ? (fields.BYDAY.split(',') as WizardWeekday[]) : wizard.weekdays) : [];
    if (fields.COUNT) wizard.ending = { type: 'count', count: Number(fields.COUNT) };
    if (fields.UNTIL) {
      // A day picker can faithfully represent only an inclusive end-of-day bound.
      if (!/^\d{8}T235959Z?$/.test(fields.UNTIL)) return null;
      const date = fields.UNTIL;
      wizard.ending = { type: 'until', date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` };
    }
    rruleFromWizard(wizard);
    return wizard;
  } catch {
    return null;
  }
}

const dayNames: Record<WizardWeekday, string> = {
  MO: 'w poniedziałek',
  TU: 'we wtorek',
  WE: 'w środę',
  TH: 'w czwartek',
  FR: 'w piątek',
  SA: 'w sobotę',
  SU: 'w niedzielę',
};

export function describeRecurrence(wizard: RecurrenceWizard): string {
  rruleFromWizard(wizard);
  const singular = { DAILY: 'codziennie', WEEKLY: 'co tydzień', MONTHLY: 'co miesiąc', YEARLY: 'co rok' };
  const few =
    wizard.interval % 10 >= 2 &&
    wizard.interval % 10 <= 4 &&
    (wizard.interval % 100 < 12 || wizard.interval % 100 > 14);
  const plural = {
    DAILY: 'dni',
    WEEKLY: few ? 'tygodnie' : 'tygodni',
    MONTHLY: few ? 'miesiące' : 'miesięcy',
    YEARLY: few ? 'lata' : 'lat',
  };
  let description =
    wizard.interval === 1 ? singular[wizard.frequency] : `co ${wizard.interval} ${plural[wizard.frequency]}`;
  if (wizard.frequency === 'WEEKLY') {
    const days = wizardWeekdays.filter((day) => wizard.weekdays.includes(day)).map((day) => dayNames[day]);
    const names = days.map((day, index) => (index === 0 ? day : day.replace(/^we? /, '')));
    description += ` ${names.length > 1 ? `${names.slice(0, -1).join(', ')} i ${names.at(-1)}` : names[0]}`;
  }
  if (wizard.ending.type === 'until')
    description += ` do ${new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${wizard.ending.date}T00:00:00Z`))}`;
  if (wizard.ending.type === 'count') {
    const count = wizard.ending.count;
    const noun =
      count === 1
        ? 'wystąpienie'
        : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)
          ? 'wystąpienia'
          : 'wystąpień';
    description += `, ${count} ${noun}`;
  }
  return description;
}
