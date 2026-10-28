import { parse } from '../../http/validation.js';
import { requireUser } from '../../http/session-auth.js';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createMyReminderSchema,
  myRemindersQuerySchema,
  myRemindersResponseSchema,
  reminderResponseSchema,
  deleteReminderResponseSchema,
  reminderScheduleSchema,
} from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { createReminderService } from './service.js';
import { readReminderSchedule } from './schedule.js';

export function registerReminderRoutes(app: FastifyInstance, database: DatabaseConnection) {
  const service = createReminderService(database);
  app.register(async (routes) => {
    routes.get('/api/reminders/schedule', async (request, reply) => {
      const query = parse(
        z
          .object({
            includeTasks: z.enum(['true', 'false']).optional(),
            includeDocuments: z.enum(['true', 'false']).optional(),
          })
          .strict(),
        request.query,
      );
      reply.header('Cache-Control', 'no-store');
      return reminderScheduleSchema.parse(
        readReminderSchedule(
          database,
          requireUser(request).familyId,
          requireUser(request).id,
          query.includeTasks === 'true',
          query.includeDocuments === 'true',
        ),
      );
    });
    routes.get('/api/reminders/mine', async (request) => {
      const source = parse(myRemindersQuerySchema, request.query);
      return myRemindersResponseSchema.parse({
        ok: true,
        reminders: service.listMine(requireUser(request).familyId, requireUser(request).id, source),
      });
    });
    routes.post('/api/reminders/mine', async (request) => {
      const data = parse(createMyReminderSchema, request.body);
      return reminderResponseSchema.parse({
        ok: true,
        reminder: service.createMine(requireUser(request).familyId, requireUser(request).id, data),
      });
    });
    routes.delete('/api/reminders/mine/:id', async (request) => {
      const { id } = parse(z.object({ id: z.string().uuid() }).strict(), request.params);
      service.removeMine(requireUser(request).familyId, requireUser(request).id, id);
      return deleteReminderResponseSchema.parse({ ok: true, deleted: true });
    });
  });
}
