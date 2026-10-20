import { eq } from 'drizzle-orm';
import {
  computeNextFireAt,
  eventUrl,
  taskUrl,
  expandEventReminderSchedule,
  type ReminderSchedule,
  type TimeReminder,
} from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { createEventRepository } from '../events/repository.js';
import { resolveRecipients } from './delivery.js';
import { createReminderRepository } from './repository.js';
import { createTaskListRepository } from '../tasks/repository.js';

/** A consistent SQLite read snapshot, independent of the cron's reservation state. */
export function readReminderSchedule(
  database: DatabaseConnection,
  familyId: string,
  userId: string,
  includeTasks = false,
): ReminderSchedule {
  return database.db.transaction(() => {
    const generatedAt = Date.now();
    const validUntil = generatedAt + 90 * 86400000;
    const repository = createEventRepository(database);
    const reminderRepository = createReminderRepository(database);
    const tz = repository.timezone(familyId);
    const members = database.db.select().from(users).where(eq(users.familyId, familyId)).all();
    const reminders: ReminderSchedule['reminders'] = [];
    for (const event of repository.list(familyId)) {
      for (const reminder of [...event.reminders, ...reminderRepository.list(familyId, event.id, userId)]) {
        if (!resolveRecipients(reminder, { event, members }).includes(userId)) continue;
        const data: TimeReminder =
          reminder.type === 'absolute'
            ? { type: 'absolute', remindAt: reminder.remindAt! }
            : { type: 'offset', offsetValue: reminder.offsetValue!, offsetUnit: reminder.offsetUnit! };
        for (const occurrence of expandEventReminderSchedule(data, event, generatedAt, validUntil, tz)) {
          const exception = event.exceptions.find((item) => item.originalDate === occurrence.occurrenceDate);
          const date = exception?.overrideStartDate ?? occurrence.occurrenceDate;
          const time = exception?.overrideStartTime !== undefined ? exception.overrideStartTime : event.startTime;
          const when =
            event.datePrecision === 'month'
              ? `${date.slice(5, 7)}.${date.slice(0, 4)}`
              : `${date.split('-').reverse().join('.')}${time === null ? '' : ` ${time}`}`;
          const names = event.participants.map((person) => person.displayName);
          reminders.push({
            key: `event:${event.id}:${reminder.id}:${occurrence.occurrenceDate}`,
            reminderId: reminder.id,
            sourceType: 'event',
            sourceId: event.id,
            occurrenceDate: occurrence.occurrenceDate,
            fireAt: occurrence.fireAt,
            title: `${when}: ${exception?.overrideTitle ?? event.title}${names.length ? ` (${names.join(', ')})` : ''}`,
            body: event.location ?? '',
            url: eventUrl(event.id, occurrence.occurrenceDate),
          });
        }
      }
    }
    const taskRepository = createTaskListRepository(database);
    for (const list of includeTasks ? taskRepository.listLists(familyId, userId) : []) {
      for (const task of taskRepository.listTasks(list.id, 'open')) {
        if (!task.dueDate) continue;
        for (const reminder of [
          ...reminderRepository.listTask(familyId, task.id),
          ...reminderRepository.listTask(familyId, task.id, userId),
        ]) {
          if (!resolveRecipients(reminder, { task, list, members }).includes(userId)) continue;
          const data: TimeReminder =
            reminder.type === 'absolute'
              ? { type: 'absolute', remindAt: reminder.remindAt! }
              : { type: 'offset', offsetValue: reminder.offsetValue!, offsetUnit: reminder.offsetUnit! };
          const fireAt = computeNextFireAt(data, reminderRepository.taskTime(task), generatedAt, tz);
          if (fireAt === null || fireAt > validUntil) continue;
          reminders.push({
            key: `task:${task.id}:${reminder.id}:${task.dueDate}`,
            reminderId: reminder.id,
            sourceType: 'task',
            sourceId: task.id,
            occurrenceDate: task.dueDate,
            fireAt,
            title: 'Przypomnienie o zadaniu',
            body: `Termin: ${task.dueDate.split('-').reverse().join('.')}${task.dueTime ? ` ${task.dueTime}` : ''}. Otwórz aplikację, aby sprawdzić szczegóły.`,
            url: taskUrl(list.id, task.id),
          });
        }
      }
    }
    reminders.sort((a, b) => a.fireAt - b.fireAt || a.key.localeCompare(b.key));
    return { ok: true, generatedAt, validUntil, reminders };
  });
}
