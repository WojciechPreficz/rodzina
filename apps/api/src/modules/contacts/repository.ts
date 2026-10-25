import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { CreateContact, PatchContact } from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { contacts, contactGroups } from '../../db/schema.js';

export function createContactRepository(database: DatabaseConnection) {
  const db = database.db;
  const contactScope = (familyId: string, id: string) => and(eq(contacts.familyId, familyId), eq(contacts.id, id));
  const groupScope = (familyId: string, id: string) =>
    and(eq(contactGroups.familyId, familyId), eq(contactGroups.id, id));
  return {
    snapshot: (familyId: string) =>
      db.transaction(() => ({
        groups: db.select().from(contactGroups).where(eq(contactGroups.familyId, familyId)).all(),
        contacts: db.select().from(contacts).where(eq(contacts.familyId, familyId)).all(),
      })),
    find: (familyId: string, id: string) => db.select().from(contacts).where(contactScope(familyId, id)).get(),
    findGroup: (familyId: string, id: string) => db.select().from(contactGroups).where(groupScope(familyId, id)).get(),
    defaultGroup: (familyId: string) =>
      db
        .select()
        .from(contactGroups)
        .where(and(eq(contactGroups.familyId, familyId), eq(contactGroups.isDefault, true)))
        .get(),
    create(familyId: string, actorId: string, data: CreateContact & { groupId: string }) {
      const now = Date.now();
      return db
        .insert(contacts)
        .values({ ...data, id: randomUUID(), familyId, createdBy: actorId, createdAt: now, updatedAt: now })
        .returning()
        .get();
    },
    update: (familyId: string, id: string, data: PatchContact) =>
      db
        .update(contacts)
        .set({ ...data, updatedAt: Date.now() })
        .where(contactScope(familyId, id))
        .returning()
        .get(),
    remove: (familyId: string, id: string) => db.delete(contacts).where(contactScope(familyId, id)).run(),
    createGroup(familyId: string, actorId: string, name: string) {
      const now = Date.now();
      return db
        .insert(contactGroups)
        .values({ id: randomUUID(), familyId, name, createdBy: actorId, createdAt: now, updatedAt: now })
        .returning()
        .get();
    },
    updateGroup: (familyId: string, id: string, name: string) =>
      db.update(contactGroups).set({ name, updatedAt: Date.now() }).where(groupScope(familyId, id)).returning().get(),
    removeGroup(familyId: string, id: string, defaultId: string) {
      db.update(contacts)
        .set({ groupId: defaultId, updatedAt: Date.now() })
        .where(and(eq(contacts.familyId, familyId), eq(contacts.groupId, id)))
        .run();
      db.delete(contactGroups).where(groupScope(familyId, id)).run();
    },
  };
}

export function createInitialContactGroups(
  database: DatabaseConnection,
  familyId: string,
  actorId: string,
  now: number,
) {
  database.db
    .insert(contactGroups)
    .values(
      ['Rodzina', 'Znajomi', 'Praca', 'Inne'].map((name) => ({
        id: randomUUID(),
        familyId,
        name,
        isDefault: name === 'Inne',
        createdBy: actorId,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .run();
}
