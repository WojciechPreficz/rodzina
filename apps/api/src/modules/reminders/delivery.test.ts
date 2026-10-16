// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { eventUrl, localDateTimeToUtc, type CalendarEvent, type Reminder } from '@rodzina/shared';
import { buildReminderPayload, resolveRecipients, type EventReminderSource } from './delivery.js';

const tz = 'Europe/Warsaw';
const utc = (date: string, time = '12:00') => localDateTimeToUtc(date, time, tz);
const members: EventReminderSource['members'] = [
  { id: 'admin', familyId: 'family', displayName: 'Mama', role: 'admin' },
  { id: 'member', familyId: 'family', displayName: 'Tata', role: 'member' },
  { id: 'child', familyId: 'family', displayName: 'Zosia', role: 'child' },
  { id: 'outsider', familyId: 'other', displayName: 'Obcy', role: 'admin' },
];
const event: CalendarEvent = {
  id: 'event',
  familyId: 'family',
  title: 'Basen',
  description: null,
  location: 'Pływalnia',
  startDate: '2026-10-20',
  startTime: '17:00',
  durationMinutes: 60,
  datePrecision: 'day',
  kind: 'single',
  rrule: null,
  createdBy: 'member',
  createdAt: 0,
  updatedAt: 0,
  participants: [{ id: 'child', displayName: 'Stare imię', color: '#000000' }],
  reminders: [],
  exceptions: [],
};
const reminder: Reminder = {
  id: 'reminder',
  familyId: 'family',
  eventId: 'event',
  taskId: null,
  documentId: null,
  type: 'offset',
  offsetValue: 1,
  offsetUnit: 'day',
  remindAt: null,
  audience: 'participants',
  userId: null,
  createdBy: 'admin',
  nextFireAt: null,
  lastSentAt: null,
};
const source: EventReminderSource = { event, members };

describe('reminder recipients', () => {
  it.each([
    ['participants', ['child']],
    ['family', ['admin', 'member', 'child']],
    ['adults', ['admin', 'member']],
    ['owner', ['member']],
    ['user', ['child']],
  ] as const)('resolves %s against current family membership', (audience, expected) => {
    expect(resolveRecipients({ ...reminder, audience, userId: audience === 'user' ? 'child' : null }, source)).toEqual(
      expected,
    );
  });

  it('uses the creator when there are no participants, including a child creator', () => {
    expect(resolveRecipients(reminder, { ...source, event: { ...event, participants: [] } })).toEqual(['member']);
    expect(
      resolveRecipients(reminder, { ...source, event: { ...event, participants: [], createdBy: 'child' } }),
    ).toEqual(['child']);
  });

  it('falls back to adults when the creator has been deleted', () => {
    const deleted = { ...source, event: { ...event, participants: [], createdBy: null } };
    expect(resolveRecipients(reminder, deleted)).toEqual(['admin', 'member']);
    expect(resolveRecipients({ ...reminder, audience: 'owner' }, deleted)).toEqual(['admin', 'member']);
  });

  it('filters stale and foreign recipients before applying the adults fallback', () => {
    for (const userId of ['deleted', 'outsider']) {
      expect(resolveRecipients({ ...reminder, audience: 'user', userId }, source)).toEqual(['admin', 'member']);
      expect(
        resolveRecipients({ ...reminder, audience: 'owner' }, { ...source, event: { ...event, createdBy: userId } }),
      ).toEqual(['admin', 'member']);
      expect(
        resolveRecipients(reminder, {
          ...source,
          event: { ...event, participants: [{ id: userId, displayName: 'Obcy', color: '#000000' }] },
        }),
      ).toEqual(['admin', 'member']);
    }
    expect(resolveRecipients(reminder, { ...source, members: members.filter(({ id }) => id !== 'child') })).toEqual([
      'admin',
      'member',
    ]);
  });

  it('deduplicates recipients and handles families without adults', () => {
    expect(resolveRecipients(reminder, { ...source, members: [...members, members[2]!] })).toEqual(['child']);
    expect(
      resolveRecipients(
        { ...reminder, audience: 'owner' },
        { event: { ...event, createdBy: null }, members: [members[2]!] },
      ),
    ).toEqual([]);
    expect(resolveRecipients(reminder, { ...source, members: [] })).toEqual([]);
  });

  it('does not deliver mismatched sources or families', () => {
    expect(resolveRecipients({ ...reminder, familyId: 'other' }, source)).toEqual([]);
    expect(resolveRecipients({ ...reminder, eventId: 'other-event' }, source)).toEqual([]);
  });
});

describe('event reminder payload', () => {
  it('builds the required next-day message with current participant names and a deep link', () => {
    expect(buildReminderPayload(source, event.startDate, utc('2026-10-19'), tz)).toEqual({
      title: 'Jutro 17:00: Basen (Zosia)',
      body: 'Pływalnia',
      tag: 'event:event:2026-10-20',
      url: eventUrl(event.id, event.startDate),
    });
  });

  it('builds the required distant-deadline message without an invented time or participants', () => {
    const distant = {
      ...event,
      title: 'USG nogi',
      kind: 'distant' as const,
      startDate: '2028-05-01',
      datePrecision: 'month' as const,
      startTime: null,
      durationMinutes: null,
      participants: [],
      location: null,
    };
    expect(buildReminderPayload({ ...source, event: distant }, distant.startDate, utc('2028-02-16'), tz)).toMatchObject(
      {
        title: 'Za 3 miesiące: USG nogi',
        body: '',
        url: eventUrl(event.id, '2028-05-01'),
      },
    );
  });

  it.each([
    [1, 'miesiąc'],
    [2, 'miesiące'],
    [5, 'miesięcy'],
    [12, 'miesięcy'],
    [22, 'miesiące'],
  ])('inflects %i months as %s', (months, label) => {
    const date = new Date(Date.UTC(2026, 0 + Number(months), 1)).toISOString().slice(0, 10);
    const distant = {
      ...event,
      startDate: date,
      startTime: null,
      durationMinutes: null,
      datePrecision: 'month' as const,
    };
    expect(buildReminderPayload({ ...source, event: distant }, date, utc('2026-01-16'), tz).title).toContain(
      `Za ${months} ${label}:`,
    );
  });

  it('uses the moved date, time and title but links to the original recurring occurrence', () => {
    const recurring: CalendarEvent = {
      ...event,
      kind: 'recurring',
      rrule: 'FREQ=WEEKLY;COUNT=3',
      exceptions: [
        {
          id: 'exception',
          eventId: event.id,
          originalDate: '2026-10-27',
          isCancelled: false,
          overrideStartDate: '2026-10-28',
          overrideStartTime: '18:30',
          overrideDurationMinutes: 45,
          overrideTitle: 'Inny basen',
        },
      ],
    };
    expect(buildReminderPayload({ ...source, event: recurring }, '2026-10-27', utc('2026-10-27'), tz)).toMatchObject({
      title: 'Jutro 18:30: Inny basen (Zosia)',
      url: eventUrl(event.id, '2026-10-27'),
      tag: 'event:event:2026-10-27',
    });
    expect(buildReminderPayload({ ...source, event: recurring }, '2026-10-20', utc('2026-10-19'), tz).title).toBe(
      'Jutro 17:00: Basen (Zosia)',
    );
  });

  it('counts local days across DST and local midnight', () => {
    for (const [date, now] of [
      ['2026-03-29', '2026-03-28'],
      ['2026-10-25', '2026-10-24'],
    ]) {
      expect(
        buildReminderPayload({ ...source, event: { ...event, startDate: date! } }, date!, utc(now!, '23:30'), tz).title,
      ).toBe('Jutro 17:00: Basen (Zosia)');
    }
    expect(buildReminderPayload(source, event.startDate, utc('2026-10-20', '00:30'), tz).title).toBe(
      'Dziś 17:00: Basen (Zosia)',
    );
  });

  it('omits removed and foreign participants and handles all-day exceptions', () => {
    const allDay = {
      ...event,
      kind: 'recurring' as const,
      rrule: 'FREQ=WEEKLY',
      exceptions: [
        {
          id: 'exception',
          eventId: event.id,
          originalDate: event.startDate,
          isCancelled: false,
          overrideStartDate: event.startDate,
          overrideStartTime: null,
          overrideDurationMinutes: null,
          overrideTitle: null,
        },
      ],
    };
    expect(buildReminderPayload({ event: allDay, members: [] }, event.startDate, utc('2026-10-19'), tz).title).toBe(
      'Jutro: Basen',
    );
  });

  it('rejects nonexistent and cancelled occurrences', () => {
    expect(() => buildReminderPayload(source, '2026-10-21', utc('2026-10-19'), tz)).toThrow(RangeError);
    const cancelled = {
      ...event,
      exceptions: [
        {
          id: 'exception',
          eventId: event.id,
          originalDate: event.startDate,
          isCancelled: true,
          overrideStartDate: null,
          overrideStartTime: null,
          overrideDurationMinutes: null,
          overrideTitle: null,
        },
      ],
    };
    expect(() => buildReminderPayload({ ...source, event: cancelled }, event.startDate, utc('2026-10-19'), tz)).toThrow(
      RangeError,
    );
  });
});
