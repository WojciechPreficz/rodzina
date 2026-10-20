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
import { EventError } from '../events/service.js';
import { createReminderService } from './service.js';
import { readReminderSchedule } from './schedule.js';

export function registerReminderRoutes(app: FastifyInstance, database: DatabaseConnection) {
  const service = createReminderService(database);
  function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) throw new EventError(400, 'VALIDATION_ERROR', 'Dane przypomnienia są niepoprawne.');
    return result.data;
  }
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
      routes.log.error({ err: error }, 'Reminder request failed');
      return reply
        .code(500)
        .send({ error: { code: 'INTERNAL_ERROR', message: 'Nie udało się obsłużyć przypomnienia.' } });
    });
    routes.get('/api/reminders/schedule', async (request, reply) => {
      const query = parse(z.object({ includeTasks: z.enum(['true', 'false']).optional() }).strict(), request.query);
      reply.header('Cache-Control', 'no-store');
      return reminderScheduleSchema.parse(
        readReminderSchedule(database, request.familyId!, request.user!.id, query.includeTasks === 'true'),
      );
    });
    routes.get('/api/reminders/mine', async (request) => {
      const source = parse(myRemindersQuerySchema, request.query);
      return myRemindersResponseSchema.parse({
        ok: true,
        reminders: service.listMine(request.familyId!, request.user!.id, source),
      });
    });
    routes.post('/api/reminders/mine', async (request) => {
      const data = parse(createMyReminderSchema, request.body);
      return reminderResponseSchema.parse({
        ok: true,
        reminder: service.createMine(request.familyId!, request.user!.id, data),
      });
    });
    routes.delete('/api/reminders/mine/:id', async (request) => {
      const { id } = parse(z.object({ id: z.string().uuid() }).strict(), request.params);
      service.removeMine(request.familyId!, request.user!.id, id);
      return deleteReminderResponseSchema.parse({ ok: true, deleted: true });
    });
  });
}
