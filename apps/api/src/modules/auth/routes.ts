import type { FastifyInstance } from 'fastify';
import type { AppConfig } from '../../config.js';
import type { DatabaseConnection } from '../../db/client.js';
import { requireUser } from '../../http/session-auth.js';
import { createAuthService } from './service.js';
import { createSessionFactory } from './session.js';

export function registerAuthRoutes(app: FastifyInstance, database: DatabaseConnection, config: AppConfig) {
  const service = createAuthService(database, config);
  const createSession = createSessionFactory(database, config);
  app.post('/api/auth/register-family', async (request, reply) => {
    return reply
      .code(201)
      .send(await service.registerFamily(request.body, (id, now) => createSession(reply, request, id, now)));
  });
  app.post('/api/auth/login', async (request, reply) => {
    return service.login(request.body, request.ip ?? 'unknown', (id, now) => createSession(reply, request, id, now));
  });
  app.get('/api/auth/family-members', async (request) => {
    return service.familyMembers(request.query);
  });
  app.post('/api/auth/login-child', async (request, reply) => {
    return service.loginChild(request.body, request.ip ?? 'unknown', (id) => createSession(reply, request, id));
  });
  app.post('/api/auth/logout', async (request, reply) => {
    const result = await service.logout(request.cookies?.sid);
    reply.clearCookie('sid', { path: '/' });
    return result;
  });
  app.get('/api/auth/me', async (request) => {
    return service.me(requireUser(request));
  });
  app.post('/api/auth/reset-password', async (request) => {
    return service.resetPassword(request.body);
  });
}
