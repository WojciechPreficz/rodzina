import type { CalendarEvent, Reminder, Task, TaskList } from '@rodzina/shared';

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

export interface TaskReminderSource {
  task: Task;
  list: TaskList;
  members: readonly ReminderMember[];
}

export function resolveRecipients(reminder: Reminder, source: EventReminderSource | TaskReminderSource): string[] {
  if ('task' in source) {
    const { task, list } = source;
    if (
      reminder.familyId !== list.familyId ||
      reminder.taskId !== task.id ||
      task.listId !== list.id ||
      reminder.eventId ||
      reminder.documentId
    )
      return [];
    const visible = source.members.filter(
      ({ id, familyId }) => familyId === list.familyId && (id === list.ownerId || list.memberIds.includes(id)),
    );
    const candidates =
      reminder.audience === 'owner'
        ? [task.assigneeId ?? list.ownerId]
        : reminder.audience === 'list_members'
          ? [list.ownerId, ...list.memberIds]
          : reminder.audience === 'user'
            ? [reminder.userId]
            : [];
    return [...new Set(visible.filter(({ id }) => candidates.includes(id)).map(({ id }) => id))];
  }
  const { event } = source;
  if (reminder.familyId !== event.familyId || reminder.eventId !== event.id || reminder.taskId || reminder.documentId)
    return [];
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
    default:
      return [];
  }
  const recipients = visible.filter(({ id }) => candidates.includes(id));
  return [...new Set((recipients.length ? recipients : adults).map(({ id }) => id))];
}
