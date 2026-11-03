import { parse } from '../../http/validation.js';
import { requireUser } from '../../http/session-auth.js';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createEventSchema,
  importEventsSchema,
  importEventsResponseSchema,
  patchEventSchema,
  eventScopeSchema,
  occurrencesQuerySchema,
  eventResponseSchema,
  distantEventsResponseSchema,
  occurrencesResponseSchema,
  deleteEventResponseSchema,
  calendarDateSchema,
  eventDuplicateResolutionSchema,
  eventDuplicatesResponseSchema,
} from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { createEventService } from './service.js';

export function registerEventRoutes(app: FastifyInstance, database: DatabaseConnection) {
  const service = createEventService(database);
  const idSchema = z.object({ id: z.string().uuid() });
  app.register(async (routes) => {
    routes.get('/api/events/duplicates', async (request) => {
      const user = requireUser(request);
      const query = parse(
        z.object({
          title: z.string().trim().min(1).max(200),
          startDate: calendarDateSchema,
          kind: z.enum(['single', 'recurring', 'distant']).default('single'),
        }),
        request.query,
      );
      return eventDuplicatesResponseSchema.parse({
        duplicates: service.duplicates(user.familyId, user.id, user.role, query.title, query.startDate, query.kind),
      });
    });
    routes.post('/api/events/import', async (request) => {
      const user = requireUser(request);
      const batch = parse(importEventsSchema, request.body);
      return importEventsResponseSchema.parse({
        ok: true,
        results: service.importEvents(user.familyId, user.id, batch),
      });
    });
    routes.post('/api/events', async (request, reply) => {
      const data = parse(createEventSchema, request.body);
      const user = requireUser(request);
      const query = parse(
        z.object({
          duplicateAction: z.enum(['check', 'add', 'replace']).optional(),
          duplicateEventId: z.string().uuid().optional(),
          duplicateVersion: z.string().optional(),
        }),
        request.query,
      );
      const resolution = query.duplicateAction
        ? parse(eventDuplicateResolutionSchema, {
            action: query.duplicateAction,
            ...(query.duplicateAction === 'replace'
              ? { eventId: query.duplicateEventId, version: query.duplicateVersion }
              : {}),
          })
        : undefined;
      const event = service.createResolved(user.familyId, user.id, user.role, data, resolution);
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
