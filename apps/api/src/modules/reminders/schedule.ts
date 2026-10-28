import { eq } from 'drizzle-orm';
import {
  computeNextFireAt,
  eventUrl,
  taskUrl,
  documentUrl,
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
import { createDocumentRepository } from '../documents/repository.js';

/** A consistent SQLite read snapshot, independent of the cron's reservation state. */
export function readReminderSchedule(
  database: DatabaseConnection,
  familyId: string,
  userId: string,
  includeTasks = false,
  includeDocuments = false,
  now = () => Date.now(),
): ReminderSchedule {
  return database.db.transaction(() => {
    const generatedAt = now();
    const validUntil = generatedAt + 90 * 86400000;
    const repository = createEventRepository(database);
    const reminderRepository = createReminderRepository(database);
    const tz = repository.timezone(familyId);
    const members = database.db.select().from(users).where(eq(users.familyId, familyId)).all();
    const reminders: ReminderSchedule['reminders'] = [];
    const events = repository.list(familyId);
    const personalEvents = reminderRepository.listMany(
      familyId,
      'eventId',
      events.map((event) => event.id),
      userId,
    );
    for (const event of events) {
      for (const reminder of [...event.reminders, ...(personalEvents.get(event.id) ?? [])]) {
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
    const taskSnapshot = includeTasks
      ? taskRepository.snapshot(familyId, userId)
      : { lists: [], items: {} as ReturnType<typeof taskRepository.snapshot>['items'] };
    const personalTasks = reminderRepository.listMany(
      familyId,
      'taskId',
      Object.values(taskSnapshot.items)
        .flat()
        .map((task) => task.id),
      userId,
    );
    for (const list of taskSnapshot.lists) {
      for (const task of taskSnapshot.items[list.id]!) {
        if (task.isDone) continue;
        if (!task.dueDate) continue;
        for (const reminder of [...(task.reminders ?? []), ...(personalTasks.get(task.id) ?? [])]) {
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
    const documents = includeDocuments ? createDocumentRepository(database).list(familyId) : [];
    const sharedDocuments = reminderRepository.listMany(
      familyId,
      'documentId',
      documents.map((document) => document.id),
    );
    const personalDocuments = reminderRepository.listMany(
      familyId,
      'documentId',
      documents.map((document) => document.id),
      userId,
    );
    for (const document of documents) {
      for (const reminder of [
        ...(sharedDocuments.get(document.id) ?? []),
        ...(personalDocuments.get(document.id) ?? []),
      ]) {
        if (!resolveRecipients(reminder, { document, members }).includes(userId)) continue;
        const data: TimeReminder =
          reminder.type === 'absolute'
            ? { type: 'absolute', remindAt: reminder.remindAt! }
            : { type: 'offset', offsetValue: reminder.offsetValue!, offsetUnit: reminder.offsetUnit! };
        const fireAt = computeNextFireAt(data, { date: document.expiresOn }, generatedAt, tz);
        if (fireAt === null || fireAt > validUntil) continue;
        reminders.push({
          key: `document:${document.id}:${reminder.id}:${document.expiresOn}`,
          reminderId: reminder.id,
          sourceType: 'document',
          sourceId: document.id,
          occurrenceDate: document.expiresOn,
          fireAt,
          title: 'Przypomnienie o dokumencie',
          body: `${document.label} — ważne do ${document.expiresOn.split('-').reverse().join('.')}`,
          url: documentUrl(document.id),
        });
      }
    }
    reminders.sort((a, b) => a.fireAt - b.fireAt || a.key.localeCompare(b.key));
    return { ok: true, generatedAt, validUntil, reminders };
  });
}
