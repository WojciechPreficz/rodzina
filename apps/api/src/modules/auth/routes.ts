import {
  registerFamilyResponseSchema,
  loginResponseSchema,
  familyMembersResponseSchema,
  loginChildResponseSchema,
  authOkResponseSchema,
  authMeResponseSchema,
} from '@rodzina/shared';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config.js';
import type { DatabaseConnection } from '../../db/client.js';
import { requireUser } from '../../http/session-auth.js';
import { createAuthService } from './service.js';
import { createSessionFactory } from './session.js';

export function registerAuthRoutes(app: FastifyInstance, database: DatabaseConnection, config: AppConfig) {
  const service = createAuthService(database, config);
  const createSession = createSessionFactory(database, config);
  app.post('/api/auth/register-family', { config: { auth: 'public' } }, async (request, reply) => {
    return reply
      .code(201)
      .send(
        registerFamilyResponseSchema.parse(
          await service.registerFamily(request.body, (id, now) => createSession(reply, request, id, now)),
        ),
      );
  });
  app.post('/api/auth/login', { config: { auth: 'public' } }, async (request, reply) => {
    return loginResponseSchema.parse(
      await service.login(request.body, request.ip ?? 'unknown', (id, now) => createSession(reply, request, id, now)),
    );
  });
  app.get('/api/auth/family-members', { config: { auth: 'public' } }, async (request) => {
    return familyMembersResponseSchema.parse(await service.familyMembers(request.query));
  });
  app.post('/api/auth/login-child', { config: { auth: 'public' } }, async (request, reply) => {
    return loginChildResponseSchema.parse(
      await service.loginChild(request.body, request.ip ?? 'unknown', (id) => createSession(reply, request, id)),
    );
  });
  app.post('/api/auth/logout', async (request, reply) => {
    const result = authOkResponseSchema.parse(await service.logout(request.cookies?.sid));
    reply.clearCookie('sid', { path: '/' });
    return result;
  });
  app.get('/api/auth/me', async (request) => {
    return authMeResponseSchema.parse(await service.me(requireUser(request)));
  });
  app.post('/api/auth/reset-password', { config: { auth: 'public' } }, async (request) => {
    return authOkResponseSchema.parse(await service.resetPassword(request.body));
  });
}
