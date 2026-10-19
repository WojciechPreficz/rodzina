import type { CalendarEvent, Reminder } from '@rodzina/shared';

export interface ReminderMember {
  id: string;
  familyId: string;
  displayName: string;
  role: 'admin' | 'member' | 'child';
}

export interface EventReminderSource {
  event: CalendarEvent;
  /** Current members, loaded when reading the schedule. */
  members: readonly ReminderMember[];
}

/** All current family members can read events, including children. */
export function resolveRecipients(reminder: Reminder, source: EventReminderSource): string[] {
  const { event } = source;
  if (reminder.familyId !== event.familyId || reminder.eventId !== event.id) return [];
  const visible = source.members.filter((member) => member.familyId === event.familyId);
  const adults = visible.filter((member) => member.role !== 'child');
  let candidates: readonly (string | null)[];
  switch (reminder.audience) {
    case 'participants':
      candidates = event.participants.length ? event.participants.map(({ id }) => id) : [event.createdBy];
      break;
    case 'family':
      candidates = visible.map(({ id }) => id);
      break;
    case 'adults':
      candidates = adults.map(({ id }) => id);
      break;
    case 'owner':
      candidates = [event.createdBy];
      break;
    case 'user':
      candidates = [reminder.userId];
      break;
  }
  const recipients = visible.filter(({ id }) => candidates.includes(id));
  return [...new Set((recipients.length ? recipients : adults).map(({ id }) => id))];
}
