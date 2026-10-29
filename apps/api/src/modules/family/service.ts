import { serializeFamily } from '../../http/family.js';
import crypto from 'node:crypto';
import type {
  CreateChildInput,
  CreateInvitationInput,
  AcceptInvitationInput,
  UpdateMemberInput,
  UpdateFamilyInput,
} from './schemas.js';
import {
  generateJoinCode,
  hashPassword,
  hashPin,
  hashToken,
  isValidPin,
  normalizeEmail,
  randomToken,
} from '../../auth.js';
import type { AppConfig } from '../../config.js';
import type { DatabaseConnection } from '../../db/client.js';
import type * as schema from '../../db/schema.js';
import { ApiError } from '../../http/errors.js';
import { serializeUser, type PublicAuthUser } from '../../http/user.js';
import {
  canEditMemberProfile,
  canManageFamilyMembers,
  canSetChildPin,
  canUpdateMemberRole,
} from '../../permissions.js';
import type { StartSession } from '../auth/service.js';
import { createFamilyRepository } from './repository.js';

export function createFamilyService(database: DatabaseConnection, config: AppConfig) {
  const repository = createFamilyRepository(database);
  async function listMembers(user: PublicAuthUser) {
    const members = repository.listMembers(user.familyId);

    return {
      ok: true,
      members: members.map((member) => serializeUser(member)),
    };
  }

  async function createChild(user: PublicAuthUser, data: CreateChildInput) {
    if (!canManageFamilyMembers(user.role) || !canSetChildPin(user.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'Tylko administrator może dodać dziecko.');
    }

    const { displayName, pin, color } = data;
    if (!isValidPin(pin)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'PIN musi mieć od 4 do 6 cyfr.');
    }

    const now = Date.now();
    const memberId = crypto.randomUUID();
    const pinHash = await hashPin(pin);

    repository.insertUser({
      id: memberId,
      familyId: user.familyId,
      displayName,
      email: null,
      passwordHash: null,
      pinHash,
      role: 'child',
      color: color ?? '#7BC6B9',
      createdAt: now,
      updatedAt: now,
    });

    const created = repository.findUser(memberId);
    if (!created) {
      throw new ApiError(500, 'INTERNAL_ERROR', 'Nie udało się pobrać utworzonego użytkownika.');
    }

    return { ok: true, member: serializeUser(created) };
  }

  async function createInvitation(user: PublicAuthUser, data: CreateInvitationInput) {
    if (!canManageFamilyMembers(user.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'Tylko administrator może tworzyć zaproszenia.');
    }

    const token = randomToken();
    const now = Date.now();
    const invitationId = crypto.randomUUID();
    repository.insertInvitation({
      id: invitationId,
      familyId: user.familyId,
      tokenHash: hashToken(token),
      role: data.role,
      createdBy: user.id,
      expiresAt: now + 1000 * 60 * 60 * 24 * 7,
      usedAt: null,
    });

    return {
      ok: true,
      invitation: {
        id: invitationId,
        role: data.role,
        expiresAt: now + 1000 * 60 * 60 * 24 * 7,
      },
      link: `${config.RODZINA_PUBLIC_URL.replace(/\/$/, '')}/zaproszenie/${token}`,
      token,
    };
  }

  async function getInvitation(token: string | undefined) {
    if (!token) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Brak tokenu zaproszenia.');
    }

    const invitation = repository.findInvitation(hashToken(token));

    if (!invitation) {
      throw new ApiError(404, 'NOT_FOUND', 'Zaproszenie nie istnieje.');
    }

    if (invitation.expiresAt <= Date.now()) {
      throw new ApiError(410, 'EXPIRED', 'Zaproszenie wygasło.');
    }

    if (invitation.usedAt) {
      throw new ApiError(410, 'USED', 'Zaproszenie zostało już wykorzystane.');
    }

    const family = repository.findFamily(invitation.familyId);
    if (!family) {
      throw new ApiError(404, 'NOT_FOUND', 'Rodzina z zaproszeniem nie istnieje.');
    }

    return {
      ok: true,
      family: { id: family.id, name: family.name },
      invitation: { id: invitation.id, role: invitation.role, expiresAt: invitation.expiresAt },
    };
  }

  async function acceptInvitation(token: string | undefined, data: AcceptInvitationInput, startSession: StartSession) {
    if (!token) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Brak tokenu zaproszenia.');
    }

    const invitation = repository.findInvitation(hashToken(token));

    if (!invitation) {
      throw new ApiError(404, 'NOT_FOUND', 'Zaproszenie nie istnieje.');
    }

    if (invitation.expiresAt <= Date.now()) {
      throw new ApiError(410, 'EXPIRED', 'Zaproszenie wygasło.');
    }

    if (invitation.usedAt) {
      throw new ApiError(410, 'USED', 'Zaproszenie zostało już wykorzystane.');
    }

    const family = repository.findFamily(invitation.familyId);
    if (!family) {
      throw new ApiError(404, 'NOT_FOUND', 'Rodzina z zaproszeniem nie istnieje.');
    }

    const normalizedEmail = normalizeEmail(data.email);
    const existingUser = repository.findUserByEmail(normalizedEmail);
    if (existingUser) {
      throw new ApiError(409, 'CONFLICT', 'Użytkownik z tym adresem e-mail już istnieje.');
    }

    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(data.password);
    const now = Date.now();

    let accepted = false;
    try {
      accepted = repository.acceptInvitation(
        invitation.id,
        {
          id: userId,
          familyId: family.id,
          displayName: data.displayName,
          email: normalizedEmail,
          passwordHash,
          role: invitation.role,
          color: '#5C7CFA',
          createdAt: now,
          updatedAt: now,
        },
        now,
      );
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new ApiError(409, 'CONFLICT', 'Użytkownik z tym adresem e-mail już istnieje.');
      }
      throw error;
    }
    if (!accepted) {
      throw new ApiError(410, 'USED', 'Zaproszenie wygasło lub zostało już wykorzystane.');
    }

    await startSession(userId);

    const created = repository.findUser(userId);
    if (!created) {
      throw new ApiError(500, 'INTERNAL_ERROR', 'Nie można odtworzyć nowego użytkownika po akceptacji zaproszenia.');
    }

    return {
      ok: true,
      family: serializeFamily(family),
      user: serializeUser(created),
    };
  }

  async function createPasswordResetLink(user: PublicAuthUser, memberId: string | undefined) {
    if (!canManageFamilyMembers(user.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'Tylko administrator może tworzyć linki resetu hasła.');
    }

    if (!memberId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Brak identyfikatora użytkownika.');
    }

    const targetUser = repository.findMember(user.familyId, memberId);
    if (!targetUser) {
      throw new ApiError(404, 'NOT_FOUND', 'Użytkownik nie istnieje w tej rodzinie.');
    }

    if (!targetUser.email || !targetUser.passwordHash) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Użytkownik nie ma aktywnego hasła do zresetowania.');
    }

    const token = randomToken();
    const resetId = crypto.randomUUID();
    const expiresAt = Date.now() + 1000 * 60 * 60 * 24;

    repository.insertPasswordReset({
      id: resetId,
      userId: targetUser.id,
      tokenHash: hashToken(token),
      expiresAt,
      usedAt: null,
    });

    return {
      ok: true,
      token,
      link: `${config.RODZINA_PUBLIC_URL.replace(/\/$/, '')}/reset-hasla/${token}`,
      expiresAt,
    };
  }

  async function updateMember(user: PublicAuthUser, memberId: string | undefined, data: UpdateMemberInput) {
    if (!memberId) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Brak identyfikatora użytkownika.');
    }

    const targetUser = repository.findMember(user.familyId, memberId);
    if (!targetUser) {
      throw new ApiError(404, 'NOT_FOUND', 'Użytkownik nie istnieje w tej rodzinie.');
    }

    const isSelf = targetUser.id === user.id;
    if (!canEditMemberProfile(user.role, user.id, targetUser.id)) {
      throw new ApiError(403, 'FORBIDDEN', 'Brak uprawnień do edycji tego użytkownika.');
    }

    const update = data;
    if (user.role !== 'admin' && !isSelf) {
      throw new ApiError(403, 'FORBIDDEN', 'Tylko administrator może edytować innych domowników.');
    }

    if (user.role !== 'admin') {
      if (update.role || update.pin) {
        throw new ApiError(403, 'FORBIDDEN', 'Dziecko i członek nie mogą zmieniać roli ani PIN-u.');
      }
    }

    if (update.role) {
      if (!canUpdateMemberRole(user.role)) {
        throw new ApiError(403, 'FORBIDDEN', 'Tylko administrator może zmieniać role.');
      }
      if ((targetUser.role === 'child') !== (update.role === 'child')) {
        throw new ApiError(
          400,
          'VALIDATION_ERROR',
          'Nie można zmieniać konta dziecka w konto dorosłego ani odwrotnie.',
        );
      }

      if (targetUser.role === 'admin' && update.role !== 'admin' && repository.countAdmins(user.familyId) <= 1) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Nie można odebrać ostatniej roli administratora.');
      }
    }

    if (update.pin) {
      if (!canSetChildPin(user.role) || (targetUser.role !== 'child' && !(update.role === 'child'))) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'PIN można ustawić tylko dla dziecka.');
      }
      if (!isValidPin(update.pin)) {
        throw new ApiError(400, 'VALIDATION_ERROR', 'PIN musi mieć od 4 do 6 cyfr.');
      }
    }

    const nextUpdatedAt = Date.now();
    const values: Partial<typeof schema.users.$inferSelect> = {
      updatedAt: nextUpdatedAt,
    };

    if (update.displayName) {
      values.displayName = update.displayName;
    }

    if (update.color) {
      values.color = update.color;
    }

    if (user.role === 'admin' && update.role) {
      values.role = update.role;
    }

    if (user.role === 'admin' && update.pin) {
      values.pinHash = await hashPin(update.pin);
    }

    if (Object.keys(values).length <= 1) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Brak danych do zmiany.');
    }

    repository.updateMember(memberId, values);

    const updated = repository.findUser(memberId);
    if (!updated) {
      throw new ApiError(500, 'INTERNAL_ERROR', 'Nie udało się pobrać zaktualizowanego użytkownika.');
    }

    return {
      ok: true,
      member: serializeUser(updated),
    };
  }

  async function updateFamily(user: PublicAuthUser, data: UpdateFamilyInput) {
    if (!canManageFamilyMembers(user.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'Tylko administrator może zmieniać nazwę rodziny.');
    }

    repository.updateFamily(user.familyId, { name: data.name });
    const updated = repository.findFamily(user.familyId);
    if (!updated) {
      throw new ApiError(500, 'INTERNAL_ERROR', 'Nie można odczytać zaktualizowanej rodziny.');
    }

    return {
      ok: true,
      family: serializeFamily(updated),
    };
  }

  async function rotateJoinCode(user: PublicAuthUser) {
    if (!canManageFamilyMembers(user.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'Tylko administrator może odświeżyć kod rodziny.');
    }

    let nextJoinCode = generateJoinCode();
    while (repository.findFamilyByCode(nextJoinCode)) {
      nextJoinCode = generateJoinCode();
    }

    repository.updateFamily(user.familyId, { joinCode: nextJoinCode });

    return {
      ok: true,
      joinCode: nextJoinCode,
    };
  }
  return {
    listMembers,
    createChild,
    createInvitation,
    getInvitation,
    acceptInvitation,
    createPasswordResetLink,
    updateMember,
    updateFamily,
    rotateJoinCode,
  };
}
