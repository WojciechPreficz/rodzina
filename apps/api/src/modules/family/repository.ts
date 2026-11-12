import { and, asc, eq, gt, isNull, lte } from 'drizzle-orm';
import { generateJoinCode } from '../../auth.js';
import type { DatabaseConnection } from '../../db/client.js';
import * as schema from '../../db/schema.js';

export function createFamilyRepository(database: DatabaseConnection) {
  function validEmailVerification(invitationId: string, tokenHash: string, now: number) {
    const table = schema.invitationEmailVerifications;
    return and(eq(table.invitationId, invitationId), eq(table.tokenHash, tokenHash), gt(table.expiresAt, now));
  }

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
    timezone: (familyId: string) =>
      database.db
        .select({ timezone: schema.families.timezone })
        .from(schema.families)
        .where(eq(schema.families.id, familyId))
        .get()!.timezone,
    findFamily: (id: string) => database.db.select().from(schema.families).where(eq(schema.families.id, id)).get(),
    findInvitation: (tokenHash: string) =>
      database.db.select().from(schema.invitations).where(eq(schema.invitations.tokenHash, tokenHash)).get(),
    insertUser: (values: typeof schema.users.$inferInsert) =>
      database.db.transaction(
        (tx) => {
          database.familyRecordLimits.requireCapacity('members', values.familyId);
          return tx.insert(schema.users).values(values).run();
        },
        { behavior: 'immediate' },
      ),
    insertInvitation: (values: typeof schema.invitations.$inferInsert) =>
      database.db.insert(schema.invitations).values(values).run(),
    insertInvitationEmailVerification(values: typeof schema.invitationEmailVerifications.$inferInsert) {
      database.db.transaction(
        (tx) => {
          const now = Date.now();
          const invitation = schema.invitations;
          const active = tx
            .select({ id: invitation.id })
            .from(invitation)
            .where(
              and(eq(invitation.id, values.invitationId), isNull(invitation.usedAt), gt(invitation.expiresAt, now)),
            )
            .get();
          if (active && values.expiresAt > now) tx.insert(schema.invitationEmailVerifications).values(values).run();
        },
        { behavior: 'immediate' },
      );
    },
    deleteExpiredInvitationEmailVerifications: (now: number) =>
      database.db
        .delete(schema.invitationEmailVerifications)
        .where(lte(schema.invitationEmailVerifications.expiresAt, now))
        .run(),
    findInvitationEmailVerification: (invitationId: string, tokenHash: string, now: number) =>
      database.db
        .select({ email: schema.invitationEmailVerifications.email })
        .from(schema.invitationEmailVerifications)
        .where(validEmailVerification(invitationId, tokenHash, now))
        .get(),
    insertPasswordReset: (values: typeof schema.passwordResets.$inferInsert) =>
      database.db.insert(schema.passwordResets).values(values).run(),
    updateMember: (familyId: string, id: string, values: Partial<typeof schema.users.$inferInsert>) =>
      database.db
        .update(schema.users)
        .set(values)
        .where(and(eq(schema.users.id, id), eq(schema.users.familyId, familyId)))
        .run(),
    removeMember: (familyId: string, id: string) =>
      database.db
        .delete(schema.users)
        .where(and(eq(schema.users.familyId, familyId), eq(schema.users.id, id)))
        .run(),
    removeFamily(familyId: string) {
      // Remove these parents before the family cascade reaches their referenced members and groups.
      database.db.delete(schema.taskLists).where(eq(schema.taskLists.familyId, familyId)).run();
      database.db.delete(schema.contacts).where(eq(schema.contacts.familyId, familyId)).run();
      database.db.delete(schema.families).where(eq(schema.families.id, familyId)).run();
    },
    updateFamily: (id: string, values: Partial<typeof schema.families.$inferInsert>) =>
      database.db.update(schema.families).set(values).where(eq(schema.families.id, id)).run(),
    rotateJoinCode(id: string) {
      return database.sqlite
        .transaction(() => {
          const joinCode = generateJoinCode(
            (code) =>
              !!database.db
                .select({ id: schema.families.id })
                .from(schema.families)
                .where(eq(schema.families.joinCode, code))
                .get(),
          );
          database.db.update(schema.families).set({ joinCode }).where(eq(schema.families.id, id)).run();
          return joinCode;
        })
        .immediate();
    },
    acceptInvitation(invitationId: string, verificationHash: string, values: typeof schema.users.$inferInsert) {
      return database.db.transaction(
        (tx) => {
          const now = Date.now();
          const verifications = schema.invitationEmailVerifications;
          const verification = tx
            .select({ email: verifications.email })
            .from(verifications)
            .where(validEmailVerification(invitationId, verificationHash, now))
            .get();
          if (!verification) return false;
          const claimed = tx
            .update(schema.invitations)
            .set({ usedAt: now })
            .where(
              and(
                eq(schema.invitations.id, invitationId),
                eq(schema.invitations.familyId, values.familyId),
                isNull(schema.invitations.usedAt),
                gt(schema.invitations.expiresAt, now),
              ),
            )
            .run();
          if (claimed.changes !== 1) return false;
          database.familyRecordLimits.requireCapacity('members', values.familyId);
          tx.insert(schema.users)
            .values({ ...values, email: verification.email })
            .run();
          tx.delete(verifications).where(eq(verifications.invitationId, invitationId)).run();
          return true;
        },
        { behavior: 'immediate' },
      );
    },
  };
}
