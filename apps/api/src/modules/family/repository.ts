import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import type { DatabaseConnection } from '../../db/client.js';
import * as schema from '../../db/schema.js';

export function createFamilyRepository(database: DatabaseConnection) {
  return {
    findMember: (familyId: string, id: string) =>
      database.db
        .select()
        .from(schema.users)
        .where(and(eq(schema.users.id, id), eq(schema.users.familyId, familyId)))
        .get(),
    countAdmins: (familyId: string) =>
      database.db
        .select()
        .from(schema.users)
        .where(and(eq(schema.users.familyId, familyId), eq(schema.users.role, 'admin')))
        .all().length,
    listMembers: (familyId: string) =>
      database.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.familyId, familyId))
        .orderBy(asc(schema.users.createdAt))
        .all(),
    findUser: (id: string) => database.db.select().from(schema.users).where(eq(schema.users.id, id)).get(),
    findUserByEmail: (email: string) =>
      database.db.select().from(schema.users).where(eq(schema.users.email, email)).get(),
    findFamily: (id: string) => database.db.select().from(schema.families).where(eq(schema.families.id, id)).get(),
    findFamilyByCode: (code: string) =>
      database.db.select().from(schema.families).where(eq(schema.families.joinCode, code)).get(),
    findInvitation: (tokenHash: string) =>
      database.db.select().from(schema.invitations).where(eq(schema.invitations.tokenHash, tokenHash)).get(),
    insertUser: (values: typeof schema.users.$inferInsert) => database.db.insert(schema.users).values(values).run(),
    insertInvitation: (values: typeof schema.invitations.$inferInsert) =>
      database.db.insert(schema.invitations).values(values).run(),
    insertPasswordReset: (values: typeof schema.passwordResets.$inferInsert) =>
      database.db.insert(schema.passwordResets).values(values).run(),
    updateMember: (id: string, values: Partial<typeof schema.users.$inferInsert>) =>
      database.db.update(schema.users).set(values).where(eq(schema.users.id, id)).run(),
    updateFamily: (id: string, values: Partial<typeof schema.families.$inferInsert>) =>
      database.db.update(schema.families).set(values).where(eq(schema.families.id, id)).run(),
    acceptInvitation(invitationId: string, values: typeof schema.users.$inferInsert, now: number) {
      return database.db.transaction((tx) => {
        const claimed = tx
          .update(schema.invitations)
          .set({ usedAt: now })
          .where(
            and(
              eq(schema.invitations.id, invitationId),
              isNull(schema.invitations.usedAt),
              gt(schema.invitations.expiresAt, now),
            ),
          )
          .run();
        if (claimed.changes !== 1) return false;
        tx.insert(schema.users).values(values).run();
        return true;
      });
    },
    removeMember(memberId: string, prepareRemoval: () => void) {
      return database.db.transaction(
        (tx) => {
          prepareRemoval();
          tx.delete(schema.sessions).where(eq(schema.sessions.userId, memberId)).run();
          tx.delete(schema.users).where(eq(schema.users.id, memberId)).run();
        },
        { behavior: 'immediate' },
      );
    },
  };
}
