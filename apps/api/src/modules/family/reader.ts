import type { DatabaseConnection } from '../../db/client.js';
import { createFamilyRepository } from './repository.js';

export function createFamilyReader(database: DatabaseConnection) {
  const repository = createFamilyRepository(database);
  return { timezone: repository.timezone, listMembers: repository.listMembers };
}
