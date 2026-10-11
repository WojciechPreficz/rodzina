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
import { createEventService, EventError } from './service.js';

export function registerEventRoutes(app: FastifyInstance, database: DatabaseConnection) {
  const service = createEventService(database);
  const idSchema = z.object({ id: z.string().uuid() });
  function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new EventError(400, 'VALIDATION_ERROR', 'Dane żądania są niepoprawne.');
    return parsed.data;
  }
  // Encapsulate error handling so existing authentication routes keep their behavior.
  app.register(async (routes) => {
    routes.setErrorHandler((error, _request, reply) => {
      if (error instanceof EventError)
        return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
      if (
        error instanceof Error &&
        'statusCode' in error &&
        typeof error.statusCode === 'number' &&
        error.statusCode < 500
      )
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Dane żądania są niepoprawne.' } });
      routes.log.error({ err: error }, 'Event request failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Nie udało się obsłużyć wydarzenia.' } });
    });
    routes.post('/api/events', async (request, reply) => {
      const data = parse(createEventSchema, request.body);
      const event = service.create(request.familyId!, request.user!.id, data);
      return reply.code(201).send(eventResponseSchema.parse({ ok: true, event }));
    });
    routes.get('/api/events/upcoming-distant', async (request) =>
      distantEventsResponseSchema.parse({ ok: true, events: service.upcomingDistant(request.familyId!) }),
    );
    routes.get('/api/events/:id', async (request) => {
      const { id } = parse(idSchema, request.params);
      return eventResponseSchema.parse({ ok: true, event: service.get(request.familyId!, id) });
    });
    routes.patch('/api/events/:id', async (request) => {
      const { id } = parse(idSchema, request.params);
      parse(eventScopeSchema, request.query);
      const data = parse(patchEventSchema, request.body);
      return eventResponseSchema.parse({
        ok: true,
        event: service.update(request.familyId!, id, request.user!.id, request.user!.role, data),
      });
    });
    routes.delete('/api/events/:id', async (request) => {
      const { id } = parse(idSchema, request.params);
      parse(eventScopeSchema, request.query);
      service.remove(request.familyId!, id, request.user!.id, request.user!.role);
      return deleteEventResponseSchema.parse({ ok: true, deleted: true });
    });
    routes.get('/api/occurrences', async (request) => {
      const { from, to, userId } = parse(occurrencesQuerySchema, request.query);
      return occurrencesResponseSchema.parse({
        ok: true,
        occurrences: service.occurrences(request.familyId!, from, to, userId),
      });
    });
  });
}
