import { parse } from '../../http/validation.js';
import {
  createChildSchema,
  createInvitationSchema,
  invitationParamsSchema,
  memberParamsSchema,
  acceptInvitationSchema,
  updateMemberSchema,
  updateFamilySchema,
} from './schemas.js';
import {
  membersResponseSchema,
  memberResponseSchema,
  createInvitationResponseSchema,
  invitationResponseSchema,
  acceptInvitationResponseSchema,
  passwordResetLinkResponseSchema,
  deleteMemberResponseSchema,
  familyResponseSchema,
  rotateJoinCodeResponseSchema,
} from '@rodzina/shared';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config.js';
import type { DatabaseConnection } from '../../db/client.js';
import { requireUser } from '../../http/session-auth.js';
import { createSessionFactory } from '../auth/session.js';
import { createFamilyService } from './service.js';
import { hashToken } from '../../auth.js';
import { createAccountDeletion, DeletionRateLimitError } from './deletion.js';

export function registerFamilyRoutes(app: FastifyInstance, database: DatabaseConnection, config: AppConfig) {
  const service = createFamilyService(database, config);
  const createSession = createSessionFactory(database, config);
  const deletion = createAccountDeletion(database);
  app.get('/api/members', async (request) =>
    membersResponseSchema.parse(await service.listMembers(requireUser(request))),
  );
  app.post('/api/members/child', async (request, reply) =>
    reply
      .code(201)
      .send(
        memberResponseSchema.parse(
          await service.createChild(
            requireUser(request),
            parse(createChildSchema, request.body, 'Dane dziecka są niepoprawne.'),
          ),
        ),
      ),
  );
  app.post('/api/invitations', async (request) =>
    createInvitationResponseSchema.parse(
      await service.createInvitation(
        requireUser(request),
        parse(createInvitationSchema, request.body, 'Rola zaproszenia jest nieprawidłowa.'),
      ),
    ),
  );
  app.get('/api/invitations/:token', { config: { auth: 'public' } }, async (request) =>
    invitationResponseSchema.parse(
      await service.getInvitation(parse(invitationParamsSchema, request.params, 'Brak tokenu zaproszenia.').token),
    ),
  );
  app.post('/api/invitations/:token/accept', { config: { auth: 'public' } }, async (request, reply) =>
    reply
      .code(201)
      .send(
        acceptInvitationResponseSchema.parse(
          await service.acceptInvitation(
            parse(invitationParamsSchema, request.params, 'Brak tokenu zaproszenia.').token,
            parse(acceptInvitationSchema, request.body, 'Dane akceptacji zaproszenia są niepoprawne.'),
            (id) => createSession(reply, request, id),
          ),
        ),
      ),
  );
  app.post('/api/members/:id/password-reset-link', async (request) =>
    passwordResetLinkResponseSchema.parse(
      await service.createPasswordResetLink(
        requireUser(request),
        parse(memberParamsSchema, request.params, 'Brak identyfikatora użytkownika.').id,
      ),
    ),
  );
  app.patch('/api/members/:id', async (request) =>
    memberResponseSchema.parse(
      await service.updateMember(
        requireUser(request),
        parse(memberParamsSchema, request.params, 'Brak identyfikatora użytkownika.').id,
        parse(updateMemberSchema, request.body, 'Dane użytkownika są niepoprawne.'),
      ),
    ),
  );
  for (const url of ['/api/members/:id', '/api/family']) {
    app.delete(url, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        const actor = requireUser(request);
        const sessionId = hashToken(request.cookies.sid!);
        const result =
          url === '/api/family'
            ? await deletion.removeFamily(actor, request.body, sessionId)
            : await deletion.removeMember(actor, parse(memberParamsSchema, request.params).id, request.body, sessionId);
        if (result.resetOwnSession) reply.clearCookie('sid', { path: '/' });
        return deleteMemberResponseSchema.parse(result);
      } catch (error) {
        if (error instanceof DeletionRateLimitError) reply.header('Retry-After', error.retryAfter);
        throw error;
      }
    });
  }
  app.patch('/api/family', async (request) =>
    familyResponseSchema.parse(
      await service.updateFamily(
        requireUser(request),
        parse(updateFamilySchema, request.body, 'Nazwa rodziny jest niepoprawna.'),
      ),
    ),
  );
  app.post('/api/family/join-code/rotate', async (request) =>
    rotateJoinCodeResponseSchema.parse(await service.rotateJoinCode(requireUser(request))),
  );
}
