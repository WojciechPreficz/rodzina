import { ApiError } from '../../http/errors.js';
import type { CreateMyReminder, MyReminderSource } from '@rodzina/shared';
import { eq } from 'drizzle-orm';
import { reminders } from '../../db/schema.js';
import type { DatabaseConnection } from '../../db/client.js';
import { createEventRepository } from '../events/repository.js';
import { createReminderRepository } from './repository.js';
import { createTaskListRepository } from '../tasks/repository.js';
import { bumpTaskOccurrence } from '../tasks/recurrence-data.js';
import { createDocumentRepository } from '../documents/repository.js';

export function createReminderService(database: DatabaseConnection) {
  const repository = createReminderRepository(database);
  const events = createEventRepository(database);
  const tasks = createTaskListRepository(database);
  const documents = createDocumentRepository(database);
  function getDocument(familyId: string, documentId: string) {
    const document = documents.find(familyId, documentId);
    if (!document) throw new ApiError(404, 'NOT_FOUND', 'Nie znaleziono dokumentu.');
    return document;
  }
  function getSource(familyId: string, eventId: string) {
    const event = events.find(familyId, eventId);
    if (!event) throw new ApiError(404, 'NOT_FOUND', 'Nie znaleziono wydarzenia.');
    return event;
  }
  function getTask(familyId: string, userId: string, taskId: string) {
    const task = tasks.findTask(familyId, userId, taskId);
    if (!task) throw new ApiError(404, 'NOT_FOUND', 'Nie znaleziono zadania.');
    return task;
  }
  function listMine(familyId: string, userId: string, source: MyReminderSource) {
    if (source.documentId) {
      getDocument(familyId, source.documentId);
      return repository.listDocument(familyId, source.documentId, userId);
    }
    if (source.taskId) {
      getTask(familyId, userId, source.taskId);
      return repository.listTask(familyId, source.taskId, userId);
    }
    getSource(familyId, source.eventId!);
    return repository.list(familyId, source.eventId!, userId);
  }
  function createMine(familyId: string, userId: string, data: CreateMyReminder) {
    if (data.documentId) {
      const document = getDocument(familyId, data.documentId);
      return repository.insertDocument(
        familyId,
        document,
        userId,
        data,
        'user',
        documents.timezone(familyId),
        Date.now(),
        userId,
      );
    }
    if (data.taskId) {
      return database.db.transaction(
        () => {
          const task = getTask(familyId, userId, data.taskId!);
          if (!task.dueDate) throw new ApiError(400, 'VALIDATION_ERROR', 'Przypomnienie wymaga daty terminu zadania.');
          const result = repository.insertTask(
            familyId,
            task,
            userId,
            data,
            'user',
            events.timezone(familyId),
            Date.now(),
            userId,
          );
          bumpTaskOccurrence(database, task.id);
          return result;
        },
        { behavior: 'immediate' },
      );
    }
    const event = getSource(familyId, data.eventId!);
    return repository.insert(familyId, event, userId, data, 'user', events.timezone(familyId), Date.now(), userId);
  }
  function removeMine(familyId: string, userId: string, id: string) {
    database.db.transaction(
      () => {
        const row = database.db.select().from(reminders).where(eq(reminders.id, id)).get();
        if (row?.taskId) getTask(familyId, userId, row.taskId);
        if (!repository.removeMine(familyId, userId, id))
          throw new ApiError(404, 'NOT_FOUND', 'Nie znaleziono przypomnienia.');
        if (row?.taskId) bumpTaskOccurrence(database, row.taskId);
      },
      { behavior: 'immediate' },
    );
  }
  return { listMine, createMine, removeMine };
}
