import crypto from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import type { CreateDocument, PatchDocument } from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { documents, families, users } from '../../db/schema.js';

export function createDocumentRepository(database: DatabaseConnection) {
  const db = database.db;
  const scope = (familyId: string, id: string) => and(eq(documents.familyId, familyId), eq(documents.id, id));
  return {
    list: (familyId: string) =>
      db
        .select()
        .from(documents)
        .where(eq(documents.familyId, familyId))
        .orderBy(asc(documents.expiresOn), asc(documents.id))
        .all(),
    find: (familyId: string, id: string) => db.select().from(documents).where(scope(familyId, id)).get(),
    timezone: (familyId: string) => db.select().from(families).where(eq(families.id, familyId)).get()!.timezone,
    hasHolder: (familyId: string, id: string) =>
      !!db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.familyId, familyId), eq(users.id, id)))
        .get(),
    create(familyId: string, actorId: string, data: CreateDocument) {
      const now = Date.now();
      return db
        .insert(documents)
        .values({ ...data, id: crypto.randomUUID(), familyId, createdBy: actorId, createdAt: now, updatedAt: now })
        .returning()
        .get();
    },
    update: (familyId: string, id: string, data: PatchDocument) =>
      db
        .update(documents)
        .set({ ...data, updatedAt: Date.now() })
        .where(scope(familyId, id))
        .returning()
        .get(),
    remove: (familyId: string, id: string) => db.delete(documents).where(scope(familyId, id)).run(),
  };
}
