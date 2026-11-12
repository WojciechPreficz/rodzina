import { routeOptions } from '../../http/route-contract.js';
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

const scheduleQuerySchema = z
  .object({
    includeTasks: z.enum(['true', 'false']).optional(),
    includeDocuments: z.enum(['true', 'false']).optional(),
    includeContacts: z.enum(['true', 'false']).optional(),
  })
  .strict();
const idSchema = z.object({ id: z.string().uuid() }).strict();

export function registerReminderRoutes(app: FastifyInstance, database: DatabaseConnection) {
  const service = createReminderService(database);
  app.register(async (routes) => {
    routes.get(
      '/api/reminders/schedule',
      routeOptions({ query: scheduleQuerySchema, responses: { 200: reminderScheduleSchema } }),
      async (request, reply) => {
        const query = parse(scheduleQuerySchema, request.query);
        reply.header('Cache-Control', 'no-store');
        return reminderScheduleSchema.parse(
          readReminderSchedule(
            database,
            requireUser(request).familyId,
            requireUser(request).id,
            query.includeTasks === 'true',
            query.includeDocuments === 'true',
            undefined,
            query.includeContacts === 'true',
          ),
        );
      },
    );
    routes.get(
      '/api/reminders/mine',
      routeOptions({ query: myRemindersQuerySchema, responses: { 200: myRemindersResponseSchema } }),
      async (request) => {
        const source = parse(myRemindersQuerySchema, request.query);
        return myRemindersResponseSchema.parse({
          ok: true,
          reminders: service.listMine(requireUser(request).familyId, requireUser(request).id, source),
        });
      },
    );
    routes.post(
      '/api/reminders/mine',
      routeOptions(
        { body: createMyReminderSchema, responses: { 200: reminderResponseSchema } },
        { idempotency: false },
      ),
      async (request) => {
        const data = parse(createMyReminderSchema, request.body);
        return reminderResponseSchema.parse({
          ok: true,
          reminder: service.createMine(requireUser(request).familyId, requireUser(request).id, data),
        });
      },
    );
    routes.delete(
      '/api/reminders/mine/:id',
      routeOptions({ params: idSchema, responses: { 200: deleteReminderResponseSchema } }, { idempotency: false }),
      async (request) => {
        const { id } = parse(idSchema, request.params);
        service.removeMine(requireUser(request).familyId, requireUser(request).id, id);
        return deleteReminderResponseSchema.parse({ ok: true, deleted: true });
      },
    );
  });
}
