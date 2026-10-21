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

export function registerFamilyRoutes(app: FastifyInstance, database: DatabaseConnection, config: AppConfig) {
  const service = createFamilyService(database, config);
  const createSession = createSessionFactory(database, config);
  app.get('/api/members', async (request) =>
    membersResponseSchema.parse(await service.listMembers(requireUser(request))),
  );
  app.post('/api/members/child', async (request, reply) =>
    reply.code(201).send(memberResponseSchema.parse(await service.createChild(requireUser(request), request.body))),
  );
  app.post('/api/invitations', async (request) =>
    createInvitationResponseSchema.parse(await service.createInvitation(requireUser(request), request.body)),
  );
  app.get('/api/invitations/:token', async (request) =>
    invitationResponseSchema.parse(
      await service.getInvitation((request.params as { token?: string } | undefined)?.token),
    ),
  );
  app.post('/api/invitations/:token/accept', async (request, reply) =>
    reply
      .code(201)
      .send(
        acceptInvitationResponseSchema.parse(
          await service.acceptInvitation(
            (request.params as { token?: string } | undefined)?.token,
            request.body,
            (id) => createSession(reply, request, id),
          ),
        ),
      ),
  );
  app.post('/api/members/:id/password-reset-link', async (request) =>
    passwordResetLinkResponseSchema.parse(
      await service.createPasswordResetLink(requireUser(request), (request.params as { id?: string } | undefined)?.id),
    ),
  );
  app.patch('/api/members/:id', async (request) =>
    memberResponseSchema.parse(
      await service.updateMember(
        requireUser(request),
        (request.params as { id?: string } | undefined)?.id,
        request.body,
      ),
    ),
  );
  app.delete('/api/members/:id', async (request) =>
    deleteMemberResponseSchema.parse(
      await service.removeMember(requireUser(request), (request.params as { id?: string } | undefined)?.id),
    ),
  );
  app.patch('/api/family', async (request) =>
    familyResponseSchema.parse(await service.updateFamily(requireUser(request), request.body)),
  );
  app.post('/api/family/join-code/rotate', async (request) =>
    rotateJoinCodeResponseSchema.parse(await service.rotateJoinCode(requireUser(request))),
  );
}
