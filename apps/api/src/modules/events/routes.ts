import { requireUser } from '../../http/session-auth.js';
import { ApiError, registerApiErrorHandler } from '../../http/errors.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createEventSchema,
  patchEventSchema,
  eventScopeSchema,
  occurrencesQuerySchema,
  eventResponseSchema,
  distantEventsResponseSchema,
  occurrencesResponseSchema,
  deleteEventResponseSchema,
} from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { createEventService } from './service.js';

export function registerEventRoutes(app: FastifyInstance, database: DatabaseConnection) {
  const service = createEventService(database);
  const idSchema = z.object({ id: z.string().uuid() });
  function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Dane żądania są niepoprawne.');
    return parsed.data;
  }
  app.register(async (routes) => {
    registerApiErrorHandler(routes, {
      internalMessage: 'Nie udało się obsłużyć wydarzenia.',
      logMessage: 'Event request failed',
    });
    routes.post('/api/events', async (request, reply) => {
      const data = parse(createEventSchema, request.body);
      const event = service.create(requireUser(request).familyId, requireUser(request).id, data);
      return reply.code(201).send(eventResponseSchema.parse({ ok: true, event }));
    });
    routes.get('/api/events/upcoming-distant', async (request) =>
      distantEventsResponseSchema.parse({ ok: true, events: service.upcomingDistant(requireUser(request).familyId) }),
    );
    routes.get('/api/events/:id', async (request) => {
      const { id } = parse(idSchema, request.params);
      return eventResponseSchema.parse({ ok: true, event: service.get(requireUser(request).familyId, id) });
    });
    routes.patch('/api/events/:id', async (request) => {
      const { id } = parse(idSchema, request.params);
      const query = parse(eventScopeSchema, request.query);
      const data = parse(patchEventSchema, request.body);
      return eventResponseSchema.parse({
        ok: true,
        event: service.update(
          requireUser(request).familyId,
          id,
          requireUser(request).id,
          requireUser(request).role,
          data,
          query,
        ),
      });
    });
    routes.delete('/api/events/:id', async (request) => {
      const { id } = parse(idSchema, request.params);
      const query = parse(eventScopeSchema, request.query);
      service.remove(requireUser(request).familyId, id, requireUser(request).id, requireUser(request).role, query);
      return deleteEventResponseSchema.parse({ ok: true, deleted: true });
    });
    routes.get('/api/occurrences', async (request) => {
      const { from, to, userId } = parse(occurrencesQuerySchema, request.query);
      return occurrencesResponseSchema.parse({
        ok: true,
        occurrences: service.occurrences(requireUser(request).familyId, from, to, userId),
      });
    });
  });
}
