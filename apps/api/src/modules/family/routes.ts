import { routeOptions } from '../../http/route-contract.js';
import { parse } from '../../http/validation.js';
import {
  createChildSchema,
  createInvitationSchema,
  invitationEmailSchema,
  invitationParamsSchema,
  memberParamsSchema,
  acceptInvitationSchema,
  updateMemberSchema,
  updateFamilySchema,
} from './schemas.js';
import {
  authOkResponseSchema,
  membersResponseSchema,
  memberResponseSchema,
  createInvitationResponseSchema,
  invitationResponseSchema,
  acceptInvitationResponseSchema,
  passwordResetLinkResponseSchema,
  deleteMemberResponseSchema,
  deleteAccountInputSchema,
  deleteFamilyInputSchema,
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
import { ApiError } from '../../http/errors.js';
import { AuthRateLimitError } from '../auth/rate-limit-service.js';
import type { sendInvitationMail } from './invitation-mail.js';

export function registerFamilyRoutes(
  app: FastifyInstance,
  database: DatabaseConnection,
  config: AppConfig,
  invitationMailSender?: typeof sendInvitationMail,
) {
  const service = createFamilyService(database, config, app.log, invitationMailSender);
  const createSession = createSessionFactory(database, config);
  const deletion = createAccountDeletion(database);
  app.get('/api/members', routeOptions({ responses: { 200: membersResponseSchema } }), async (request) =>
    membersResponseSchema.parse(await service.listMembers(requireUser(request))),
  );
  app.post(
    '/api/members/child',
    routeOptions({ body: createChildSchema, responses: { 201: memberResponseSchema } }, { idempotency: false }),
    async (request, reply) =>
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
  app.post(
    '/api/invitations',
    routeOptions(
      { body: createInvitationSchema, responses: { 200: createInvitationResponseSchema } },
      { idempotency: false },
    ),
    async (request) =>
      createInvitationResponseSchema.parse(
        await service.createInvitation(
          requireUser(request),
          parse(createInvitationSchema, request.body, 'Rola zaproszenia jest nieprawidłowa.'),
        ),
      ),
  );
  app.get(
    '/api/invitations/:token',
    routeOptions({ params: invitationParamsSchema, responses: { 200: invitationResponseSchema } }, { auth: 'public' }),
    async (request) =>
      invitationResponseSchema.parse(
        await service.getInvitation(parse(invitationParamsSchema, request.params, 'Brak tokenu zaproszenia.').token),
      ),
  );
  app.post(
    '/api/invitations/:token/email-verification',
    routeOptions(
      { params: invitationParamsSchema, body: invitationEmailSchema, responses: { 202: authOkResponseSchema } },
      { auth: 'public', idempotency: false },
    ),
    async (request, reply) => {
      const { token } = parse(invitationParamsSchema, request.params, 'Brak tokenu zaproszenia.');
      const { email } = parse(invitationEmailSchema, request.body, 'Podaj prawidłowy adres e-mail.');
      try {
        return reply
          .code(202)
          .send(authOkResponseSchema.parse(await service.requestInvitationEmail(token, email, request.ip)));
      } catch (error) {
        if (error instanceof AuthRateLimitError) reply.header('Retry-After', error.retryAfter);
        throw error;
      }
    },
  );
  app.post(
    '/api/invitations/:token/accept',
    routeOptions(
      {
        params: invitationParamsSchema,
        body: acceptInvitationSchema,
        responses: { 201: acceptInvitationResponseSchema },
      },
      { auth: 'public', idempotency: false },
    ),
    async (request, reply) => {
      const { token } = parse(invitationParamsSchema, request.params, 'Brak tokenu zaproszenia.');
      const data = parse(acceptInvitationSchema, request.body, 'Dane akceptacji zaproszenia są niepoprawne.');
      if ('email' in data) {
        try {
          await service.requestInvitationEmail(token, data.email, request.ip);
        } catch (error) {
          if (error instanceof AuthRateLimitError) reply.header('Retry-After', error.retryAfter);
          throw error;
        }
        throw new ApiError(
          409,
          'EMAIL_CONFIRMATION_REQUIRED',
          'Sprawdź pocztę. Jeśli otrzymasz link potwierdzający, otwórz go w przeglądarce, aby dołączyć do rodziny. Potem możesz zalogować się w aplikacji.',
        );
      }
      const result = await service.acceptInvitation(token, data, (id) => createSession(reply, request, id));
      return reply.code(201).send(acceptInvitationResponseSchema.parse(result));
    },
  );
  app.post(
    '/api/members/:id/password-reset-link',
    routeOptions(
      { params: memberParamsSchema, responses: { 200: passwordResetLinkResponseSchema } },
      { idempotency: false },
    ),
    async (request) =>
      passwordResetLinkResponseSchema.parse(
        await service.createPasswordResetLink(
          requireUser(request),
          parse(memberParamsSchema, request.params, 'Brak identyfikatora użytkownika.').id,
        ),
      ),
  );
  app.patch(
    '/api/members/:id',
    routeOptions(
      { params: memberParamsSchema, body: updateMemberSchema, responses: { 200: memberResponseSchema } },
      { idempotency: false },
    ),
    async (request) =>
      memberResponseSchema.parse(
        await service.updateMember(
          requireUser(request),
          parse(memberParamsSchema, request.params, 'Brak identyfikatora użytkownika.').id,
          parse(updateMemberSchema, request.body, 'Dane użytkownika są niepoprawne.'),
        ),
      ),
  );
  for (const url of ['/api/members/:id', '/api/family']) {
    const removesFamily = url === '/api/family';
    app.delete(
      url,
      routeOptions(
        {
          params: removesFamily ? undefined : memberParamsSchema,
          body: removesFamily ? deleteFamilyInputSchema : deleteAccountInputSchema,
          responses: { 200: deleteMemberResponseSchema },
        },
        { idempotency: false },
      ),
      async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        try {
          const actor = requireUser(request);
          const sessionId = hashToken(request.cookies.sid!);
          const result = removesFamily
            ? await deletion.removeFamily(actor, request.body, sessionId)
            : await deletion.removeMember(actor, parse(memberParamsSchema, request.params).id, request.body, sessionId);
          if (result.resetOwnSession) reply.clearCookie('sid', { path: '/' });
          return deleteMemberResponseSchema.parse(result);
        } catch (error) {
          if (error instanceof DeletionRateLimitError) reply.header('Retry-After', error.retryAfter);
          throw error;
        }
      },
    );
  }
  app.patch(
    '/api/family',
    routeOptions({ body: updateFamilySchema, responses: { 200: familyResponseSchema } }, { idempotency: false }),
    async (request) =>
      familyResponseSchema.parse(
        await service.updateFamily(
          requireUser(request),
          parse(updateFamilySchema, request.body, 'Nazwa rodziny jest niepoprawna.'),
        ),
      ),
  );
  app.post(
    '/api/family/join-code/rotate',
    routeOptions({ responses: { 200: rotateJoinCodeResponseSchema } }, { idempotency: false }),
    async (request) => rotateJoinCodeResponseSchema.parse(await service.rotateJoinCode(requireUser(request))),
  );
}
