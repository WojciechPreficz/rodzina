import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createTaskListSchema,
  patchTaskListSchema,
  taskListsResponseSchema,
  taskListResponseSchema,
  taskListDeletedResponseSchema,
  taskListLeftResponseSchema,
  createTaskSchema,
  patchTaskSchema,
  tasksQuerySchema,
  tasksResponseSchema,
  taskResponseSchema,
  taskDeletedResponseSchema,
} from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { createTaskListService, TaskListError } from './service.js';

export function registerTaskListRoutes(app: FastifyInstance, database: DatabaseConnection) {
  const service = createTaskListService(database);
  const idSchema = z.object({ id: z.string().uuid() });
  function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new TaskListError(400, 'VALIDATION_ERROR', 'Dane żądania są niepoprawne.');
    return parsed.data;
  }
  app.register(async (routes) => {
    routes.setErrorHandler((error, _request, reply) => {
      if (error instanceof TaskListError)
        return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
      if (
        error instanceof Error &&
        'statusCode' in error &&
        typeof error.statusCode === 'number' &&
        error.statusCode < 500
      )
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Dane żądania są niepoprawne.' } });
      routes.log.error({ err: error }, 'Task request failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Nie udało się obsłużyć zadań.' } });
    });
    routes.get('/api/tasks/lists/:id/tasks', (request) => {
      const { id } = parse(idSchema, request.params);
      const { status } = parse(tasksQuerySchema, request.query);
      return tasksResponseSchema.parse({
        ok: true,
        tasks: service.listTasks(request.familyId!, request.user!.id, id, status),
      });
    });
    routes.post('/api/tasks/lists/:id/tasks', (request, reply) => {
      const { id } = parse(idSchema, request.params);
      const data = parse(createTaskSchema, request.body);
      const task = service.createTask(request.familyId!, request.user!.id, id, data);
      reply.code(201);
      return taskResponseSchema.parse({ ok: true, task });
    });
    routes.patch('/api/tasks/:id', (request) => {
      const { id } = parse(idSchema, request.params);
      const data = parse(patchTaskSchema, request.body);
      return taskResponseSchema.parse({
        ok: true,
        task: service.updateTask(request.familyId!, request.user!.id, id, data),
      });
    });
    routes.delete('/api/tasks/:id', (request) => {
      const { id } = parse(idSchema, request.params);
      service.removeTask(request.familyId!, request.user!.id, id);
      return taskDeletedResponseSchema.parse({ ok: true, deleted: true });
    });
    routes.get('/api/tasks/today', (request) =>
      tasksResponseSchema.parse({
        ok: true,
        tasks: service.todayTasks(request.familyId!, request.user!.id),
      }),
    );
    routes.get('/api/tasks/lists', async (request) =>
      taskListsResponseSchema.parse({
        ok: true,
        lists: service.listLists(request.familyId!, request.user!.id),
      }),
    );
    routes.post('/api/tasks/lists', (request, reply) => {
      const data = parse(createTaskListSchema, request.body);
      const list = service.createList(request.familyId!, request.user!.id, data);
      reply.code(201);
      return taskListResponseSchema.parse({ ok: true, list });
    });
    routes.patch('/api/tasks/lists/:id', (request) => {
      const { id } = parse(idSchema, request.params);
      const data = parse(patchTaskListSchema, request.body);
      return taskListResponseSchema.parse({
        ok: true,
        list: service.updateList(request.familyId!, request.user!.id, id, data),
      });
    });
    routes.delete('/api/tasks/lists/:id', (request) => {
      const { id } = parse(idSchema, request.params);
      service.removeList(request.familyId!, request.user!.id, id);
      return taskListDeletedResponseSchema.parse({ ok: true, deleted: true });
    });
    routes.post('/api/tasks/lists/:id/leave', (request) => {
      const { id } = parse(idSchema, request.params);
      service.leaveList(request.familyId!, request.user!.id, id);
      return taskListLeftResponseSchema.parse({ ok: true, left: true });
    });
  });
}
