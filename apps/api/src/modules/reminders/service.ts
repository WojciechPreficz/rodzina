import type { CreateMyReminder, MyReminderSource } from '@rodzina/shared';
import { eq } from 'drizzle-orm';
import { reminders } from '../../db/schema.js';
import type { DatabaseConnection } from '../../db/client.js';
import { createEventRepository } from '../events/repository.js';
import { EventError } from '../events/service.js';
import { createReminderRepository } from './repository.js';
import { createTaskListRepository } from '../tasks/repository.js';

export function createReminderService(database: DatabaseConnection) {
  const repository = createReminderRepository(database);
  const events = createEventRepository(database);
  const tasks = createTaskListRepository(database);
  function getSource(familyId: string, eventId: string) {
    const event = events.find(familyId, eventId);
    if (!event) throw new EventError(404, 'NOT_FOUND', 'Nie znaleziono wydarzenia.');
    return event;
  }
  function getTask(familyId: string, userId: string, taskId: string) {
    const task = tasks.findTask(familyId, userId, taskId);
    if (!task) throw new EventError(404, 'NOT_FOUND', 'Nie znaleziono zadania.');
    return task;
  }
  function listMine(familyId: string, userId: string, source: MyReminderSource) {
    if (source.taskId) {
      getTask(familyId, userId, source.taskId);
      return repository.listTask(familyId, source.taskId, userId);
    }
    getSource(familyId, source.eventId!);
    return repository.list(familyId, source.eventId!, userId);
  }
  function createMine(familyId: string, userId: string, data: CreateMyReminder) {
    if (data.taskId) {
      const task = getTask(familyId, userId, data.taskId);
      if (!task.dueDate) throw new EventError(400, 'VALIDATION_ERROR', 'Przypomnienie wymaga daty terminu zadania.');
      return repository.insertTask(familyId, task, userId, data, 'user', events.timezone(familyId), Date.now(), userId);
    }
    const event = getSource(familyId, data.eventId!);
    return repository.insert(familyId, event, userId, data, 'user', events.timezone(familyId), Date.now(), userId);
  }
  function removeMine(familyId: string, userId: string, id: string) {
    const row = database.db.select().from(reminders).where(eq(reminders.id, id)).get();
    if (row?.taskId) getTask(familyId, userId, row.taskId);
    if (!repository.removeMine(familyId, userId, id))
      throw new EventError(404, 'NOT_FOUND', 'Nie znaleziono przypomnienia.');
  }
  return { listMine, createMine, removeMine };
}
