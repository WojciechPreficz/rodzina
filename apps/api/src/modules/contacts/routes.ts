import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createContactSchema,
  patchContactSchema,
  createContactGroupSchema,
  patchContactGroupSchema,
  contactsResponseSchema,
  contactResponseSchema,
  contactGroupResponseSchema,
  contactDeletedResponseSchema,
} from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { requireUser } from '../../http/session-auth.js';
import { ApiError, registerApiErrorHandler } from '../../http/errors.js';
import { createContactService } from './service.js';

export function registerContactRoutes(app: FastifyInstance, database: DatabaseConnection) {
  const service = createContactService(database);
  const idSchema = z.object({ id: z.string().uuid() });
  function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Dane kontaktu lub grupy są niepoprawne.');
    return result.data;
  }
  app.register(async (routes) => {
    registerApiErrorHandler(routes, {
      internalMessage: 'Nie udało się obsłużyć kontaktów.',
      logMessage: 'Contact request failed',
    });
    routes.get('/api/contacts', async (request) =>
      contactsResponseSchema.parse({ ok: true, ...service.snapshot(requireUser(request).familyId) }),
    );
    routes.post('/api/contacts', (request, reply) => {
      const user = requireUser(request);
      const contact = service.create(user.familyId, user.id, user.role, parse(createContactSchema, request.body));
      return reply.code(201).send(contactResponseSchema.parse({ ok: true, contact }));
    });
    routes.patch('/api/contacts/:id', (request) => {
      const user = requireUser(request);
      const { id } = parse(idSchema, request.params);
      return contactResponseSchema.parse({
        ok: true,
        contact: service.update(user.familyId, id, user.role, parse(patchContactSchema, request.body)),
      });
    });
    routes.delete('/api/contacts/:id', (request) => {
      const user = requireUser(request);
      service.remove(user.familyId, parse(idSchema, request.params).id, user.role);
      return contactDeletedResponseSchema.parse({ ok: true, deleted: true });
    });
    routes.post('/api/contact-groups', (request, reply) => {
      const user = requireUser(request);
      const group = service.createGroup(
        user.familyId,
        user.id,
        user.role,
        parse(createContactGroupSchema, request.body).name,
      );
      return reply.code(201).send(contactGroupResponseSchema.parse({ ok: true, group }));
    });
    routes.patch('/api/contact-groups/:id', (request) => {
      const user = requireUser(request);
      const { id } = parse(idSchema, request.params);
      return contactGroupResponseSchema.parse({
        ok: true,
        group: service.updateGroup(user.familyId, id, user.role, parse(patchContactGroupSchema, request.body).name),
      });
    });
    routes.delete('/api/contact-groups/:id', (request) => {
      const user = requireUser(request);
      service.removeGroup(user.familyId, parse(idSchema, request.params).id, user.role);
      return contactDeletedResponseSchema.parse({ ok: true, deleted: true });
    });
  });
}
