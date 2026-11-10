import { deleteAccountInputSchema, deleteFamilyInputSchema } from '@rodzina/shared';
import { verifyPassword } from '../../auth.js';
import type { DatabaseConnection } from '../../db/client.js';
import { ApiError } from '../../http/errors.js';
import { parse } from '../../http/validation.js';
import type { PublicAuthUser } from '../../http/user.js';
import { createAuthRateLimitService } from '../auth/rate-limit-service.js';
import { createSessionService } from '../auth/session.js';
import { createTaskListService } from '../tasks/service.js';
import { createFamilyRepository } from './repository.js';

export class DeletionRateLimitError extends ApiError {
  constructor(public retryAfter: number) {
    super(429, 'RATE_LIMITED', 'Za dużo prób potwierdzenia hasła. Spróbuj ponownie później.');
  }
}

export function createAccountDeletion(database: DatabaseConnection) {
  const repository = createFamilyRepository(database);
  const limits = createAuthRateLimitService(database);
  const sessions = createSessionService(database);
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
    const retryAfter = limits.consumeDeletionAttempt(actor.id, Date.now());
    if (retryAfter) throw new DeletionRateLimitError(retryAfter);
    const user = repository.findMember(actor.familyId, actor.id);
    if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, password)))
      throw new ApiError(403, 'INVALID_CREDENTIALS', 'Nieprawidłowe hasło.');
    return user.passwordHash;
  }

  function currentActor(actor: PublicAuthUser, sessionId: string, expectedHash: string) {
    const session = sessions.sessionBelongsTo(sessionId, actor.id, Date.now());
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
        () => {
          authorize(currentActor(actor, sessionId, expectedHash), memberId);
          tasks.prepareMemberRemoval(actor.familyId, memberId);
          limits.clearDeletionAttempts(memberId);
          repository.removeMember(actor.familyId, memberId);
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
        () => {
          authorize(currentActor(actor, sessionId, expectedHash));
          const family = repository.findFamily(actor.familyId);
          if (!family || family.name.trim() !== confirmationName)
            throw new ApiError(400, 'VALIDATION_ERROR', 'Wpisana nazwa rodziny jest nieprawidłowa.');
          for (const member of repository.listMembers(actor.familyId)) limits.clearDeletionAttempts(member.id);
          repository.removeFamily(actor.familyId);
        },
        { behavior: 'immediate' },
      );
      return { ok: true, deleted: true, resetOwnSession: true };
    },
  };
}
