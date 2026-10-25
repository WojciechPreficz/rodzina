import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import { generateJoinCode } from '../../auth.js';
import type { DatabaseConnection } from '../../db/client.js';
import * as schema from '../../db/schema.js';
import { createInitialContactGroups } from '../contacts/repository.js';

export function createAuthRepository(database: DatabaseConnection) {
  return {
    findUserByEmail: (email: string) =>
      database.db.select().from(schema.users).where(eq(schema.users.email, email)).get(),
    findUser: (id: string) => database.db.select().from(schema.users).where(eq(schema.users.id, id)).get(),
    findFamily: (id: string) => database.db.select().from(schema.families).where(eq(schema.families.id, id)).get(),
    findFamilyByCode: (code: string) =>
      database.db.select().from(schema.families).where(eq(schema.families.joinCode, code)).get(),
    findChild: (familyId: string, id: string) =>
      database.db
        .select()
        .from(schema.users)
        .where(and(eq(schema.users.id, id), eq(schema.users.familyId, familyId), eq(schema.users.role, 'child')))
        .get(),
    listChildren: (familyId: string) =>
      database.db
        .select({ id: schema.users.id, displayName: schema.users.displayName, color: schema.users.color })
        .from(schema.users)
        .where(and(eq(schema.users.familyId, familyId), eq(schema.users.role, 'child')))
        .orderBy(asc(schema.users.createdAt))
        .all(),
    insertSession: (values: typeof schema.sessions.$inferInsert) =>
      database.db.insert(schema.sessions).values(values).run(),
    deleteSession: (id: string) => database.db.delete(schema.sessions).where(eq(schema.sessions.id, id)).run(),
    findPasswordReset: (tokenHash: string) =>
      database.db.select().from(schema.passwordResets).where(eq(schema.passwordResets.tokenHash, tokenHash)).get(),
    registerFamily({
      familyId,
      userId,
      familyName,
      displayName,
      normalizedEmail,
      passwordHash,
      now,
    }: {
      familyId: string;
      userId: string;
      familyName: string;
      displayName: string;
      normalizedEmail: string;
      passwordHash: string;
      now: number;
    }) {
      return database.db.transaction((tx) => {
        let joinCode = generateJoinCode();

        while (tx.select().from(schema.families).where(eq(schema.families.joinCode, joinCode)).get()) {
          joinCode = generateJoinCode();
        }

        tx.insert(schema.families)
          .values({
            id: familyId,
            name: familyName,
            timezone: 'Europe/Warsaw',
            joinCode,
            createdAt: now,
          })
          .run();

        tx.insert(schema.users)
          .values({
            id: userId,
            familyId,
            displayName,
            email: normalizedEmail,
            passwordHash,
            role: 'admin',
            color: '#5C7CFA',
            createdAt: now,
            updatedAt: now,
          })
          .run();
        createInitialContactGroups(database, familyId, userId, now);
      });
    },
    resetPassword(resetRequest: typeof schema.passwordResets.$inferSelect, passwordHash: string, now: number) {
      return database.db.transaction((tx) => {
        const claimed = tx
          .update(schema.passwordResets)
          .set({ usedAt: now })
          .where(
            and(
              eq(schema.passwordResets.id, resetRequest.id),
              isNull(schema.passwordResets.usedAt),
              gt(schema.passwordResets.expiresAt, now),
            ),
          )
          .run();
        if (claimed.changes !== 1) return false;
        tx.update(schema.users)
          .set({ passwordHash, updatedAt: now })
          .where(eq(schema.users.id, resetRequest.userId))
          .run();
        return true;
      });
    },
  };
}
