import type { Family } from '@rodzina/shared';
import type { families } from '../db/schema.js';

export function serializeFamily(family: Pick<typeof families.$inferSelect, keyof Family>): Family {
  return { id: family.id, name: family.name, timezone: family.timezone, joinCode: family.joinCode };
}
