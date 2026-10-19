// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CalendarEvent, Reminder } from '@rodzina/shared';
import { resolveRecipients, type EventReminderSource } from './delivery.js';

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
