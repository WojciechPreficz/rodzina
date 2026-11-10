import type { DatabaseConnection } from '../../db/client.js';
import { createReminderRepository } from './repository.js';

// Used by source modules inside the same transaction as the source mutation.
export function createReminderSourcePort(database: DatabaseConnection) {
  const {
    list,
    listMany,
    listTask,
    listAllTask,
    listDocument,
    saveEvent,
    saveTask,
    saveDocument,
    transferEventReminders,
  } = createReminderRepository(database);
  return {
    list,
    listMany,
    listTask,
    listAllTask,
    listDocument,
    saveEvent,
    saveTask,
    saveDocument,
    transferEventReminders,
  };
}
