import { and, eq, gt } from 'drizzle-orm';
import { deleteAccountInputSchema, deleteFamilyInputSchema } from '@rodzina/shared';
import { hashToken, verifyPassword } from '../../auth.js';
import type { DatabaseConnection } from '../../db/client.js';
import * as schema from '../../db/schema.js';
import { ApiError } from '../../http/errors.js';
import { parse } from '../../http/validation.js';
import type { PublicAuthUser } from '../../http/user.js';
import { createAuthRateLimitRepository } from '../auth/rate-limit-repository.js';
import { createTaskListService } from '../tasks/service.js';
import { createFamilyRepository } from './repository.js';

export class DeletionRateLimitError extends ApiError {
  constructor(public retryAfter: number) {
    super(429, 'RATE_LIMITED', 'Za dużo prób potwierdzenia hasła. Spróbuj ponownie później.');
  }
}

const limitKey = (userId: string) => hashToken(JSON.stringify(['account-deletion', userId]));

export function createAccountDeletion(database: DatabaseConnection) {
  const repository = createFamilyRepository(database);
  const limits = createAuthRateLimitRepository(database);
  const tasks = createTaskListService(database);

  function authorize(actor: PublicAuthUser, memberId?: string) {
    if (actor.role === 'child') throw new ApiError(403, 'FORBIDDEN', 'Dzieci nie mogą usuwać kont.');
    if (!memberId) {
      if (actor.role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'Tylko administrator może usunąć całą rodzinę.');
      return;
    }
    const target = repository.findMember(actor.familyId, memberId);
    if (!target) throw new ApiError(404, 'NOT_FOUND', 'Użytkownik nie istnieje w tej rodzinie.');
    if (actor.role !== 'admin' && actor.id !== memberId && target.role !== 'child')
      throw new ApiError(403, 'FORBIDDEN', 'Możesz usunąć tylko własne konto lub konto dziecka.');
    if (target.role === 'admin' && repository.countAdmins(actor.familyId) <= 1)
      throw new ApiError(
        409,
        'LAST_ADMIN',
        'Najpierw nadaj rolę administratora innemu dorosłemu albo usuń całą rodzinę.',
      );
  }

  async function confirm(actor: PublicAuthUser, password: string) {
    const now = Date.now();
    limits.deleteExpired(now);
    const key = limitKey(actor.id);
    if (!limits.consume(key, now, 10, 15 * 60_000)) {
      const record = database.db
        .select()
        .from(schema.authRateLimits)
        .where(eq(schema.authRateLimits.scopeKey, key))
        .get()!;
      throw new DeletionRateLimitError(Math.max(1, Math.ceil((record.expiresAt - now) / 1000)));
    }
    const user = repository.findMember(actor.familyId, actor.id);
    if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, password)))
      throw new ApiError(403, 'INVALID_CREDENTIALS', 'Nieprawidłowe hasło.');
    return user.passwordHash;
  }

  function currentActor(actor: PublicAuthUser, sessionId: string, expectedHash: string) {
    const session = database.db
      .select()
      .from(schema.sessions)
      .where(
        and(
          eq(schema.sessions.id, sessionId),
          eq(schema.sessions.userId, actor.id),
          gt(schema.sessions.expiresAt, Date.now()),
        ),
      )
      .get();
    const current = repository.findMember(actor.familyId, actor.id);
    if (!session || !current) throw new ApiError(401, 'UNAUTHORIZED', 'Sesja wygasła. Zaloguj się ponownie.');
    if (current.passwordHash !== expectedHash)
      throw new ApiError(403, 'INVALID_CREDENTIALS', 'Hasło zmieniło się. Potwierdź operację ponownie.');
    return current;
  }

  return {
    async removeMember(actor: PublicAuthUser, memberId: string, body: unknown, sessionId: string) {
      authorize(actor, memberId);
      if (body === undefined || (body && typeof body === 'object' && !('password' in body)))
        throw new ApiError(
          409,
          'ACCOUNT_DELETION_UPDATE_REQUIRED',
          'Zaktualizuj aplikację, aby potwierdzić usunięcie konta hasłem.',
        );
      const { password } = parse(deleteAccountInputSchema, body, 'Podaj swoje hasło.');
      const expectedHash = await confirm(actor, password);
      database.db.transaction(
        (tx) => {
          authorize(currentActor(actor, sessionId, expectedHash), memberId);
          tasks.prepareMemberRemoval(actor.familyId, memberId);
          limits.clear(limitKey(memberId));
          tx.delete(schema.users)
            .where(and(eq(schema.users.id, memberId), eq(schema.users.familyId, actor.familyId)))
            .run();
        },
        { behavior: 'immediate' },
      );
      return { ok: true, deleted: true, resetOwnSession: actor.id === memberId };
    },
    async removeFamily(actor: PublicAuthUser, body: unknown, sessionId: string) {
      authorize(actor);
      const { password, confirmationName } = parse(deleteFamilyInputSchema, body, 'Podaj hasło i nazwę rodziny.');
      const expectedHash = await confirm(actor, password);
      database.db.transaction(
        (tx) => {
          authorize(currentActor(actor, sessionId, expectedHash));
          const family = repository.findFamily(actor.familyId);
          if (!family || family.name.trim() !== confirmationName)
            throw new ApiError(400, 'VALIDATION_ERROR', 'Wpisana nazwa rodziny jest nieprawidłowa.');
          for (const member of repository.listMembers(actor.familyId)) limits.clear(limitKey(member.id));
          tx.delete(schema.taskLists).where(eq(schema.taskLists.familyId, actor.familyId)).run();
          tx.delete(schema.contacts).where(eq(schema.contacts.familyId, actor.familyId)).run();
          tx.delete(schema.families).where(eq(schema.families.id, actor.familyId)).run();
        },
        { behavior: 'immediate' },
      );
      return { ok: true, deleted: true, resetOwnSession: true };
    },
  };
}
