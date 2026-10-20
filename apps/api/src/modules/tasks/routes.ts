import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
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
    routes.addHook('onRoute', (options) => {
      if (!['POST', 'PATCH', 'DELETE'].includes(String(options.method))) return;
      if (options.url !== '/api/tasks/lists/:id/tasks' && options.url !== '/api/tasks/:id') return;
      const handler = options.handler;
      options.handler = function (request, reply) {
        const { operationId, actorId, taskId } = parse(
          z
            .object({
              operationId: z.string().uuid().optional(),
              actorId: z.string().uuid().optional(),
              taskId: z.string().uuid().optional(),
            })
            .strict(),
          request.query,
        );
        if (actorId && actorId !== request.user!.id)
          throw new TaskListError(401, 'SESSION_CHANGED', 'Konto zostało zmienione. Zaloguj się ponownie.');
        if (!operationId) return handler.call(this, request, reply);
        if (taskId && request.method !== 'POST')
          throw new TaskListError(400, 'VALIDATION_ERROR', 'Dane żądania są niepoprawne.');
        const fingerprint = createHash('sha256')
          .update(JSON.stringify([request.familyId, request.method, request.url, request.body]))
          .digest('hex');
        return database.sqlite
          .transaction(() => {
            const previous = database.sqlite
              .prepare('SELECT * FROM task_operations WHERE user_id = ? AND id = ?')
              .get(request.user!.id, operationId) as
              { list_id: string; fingerprint: string; response: string; status: number } | undefined;
            // Saved responses contain private task content. Recheck access even
            // when the operation already committed before the response was lost.
            if (previous) {
              if (!service.canAccessList(request.familyId!, request.user!.id, previous.list_id))
                throw new TaskListError(404, 'NOT_FOUND', 'Lista zadań nie istnieje.');
              if (previous.fingerprint !== fingerprint)
                throw new TaskListError(409, 'OPERATION_CONFLICT', 'Ta zmiana została już wysłana z innymi danymi.');
              reply.code(previous.status);
              return JSON.parse(previous.response);
            }
            const { id } = parse(idSchema, request.params);
            const listId =
              request.method === 'POST'
                ? id
                : (
                    database.sqlite.prepare('SELECT list_id FROM tasks WHERE id = ?').get(id) as
                      { list_id: string } | undefined
                  )?.list_id;
            if (!listId || !service.canAccessList(request.familyId!, request.user!.id, listId))
              throw new TaskListError(404, 'NOT_FOUND', 'Lista zadań nie istnieje.');
            const response = handler.call(this, request, reply);
            database.sqlite
              .prepare(
                'INSERT INTO task_operations (user_id, id, list_id, fingerprint, response, status) VALUES (?, ?, ?, ?, ?, ?)',
              )
              .run(request.user!.id, operationId, listId, fingerprint, JSON.stringify(response), reply.statusCode);
            return response;
          })
          .immediate();
      };
    });
    routes.setErrorHandler((error, _request, reply) => {
      if (error instanceof TaskListError)
        return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
      if (error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY')
        return reply
          .code(409)
          .send({ error: { code: 'OPERATION_CONFLICT', message: 'Identyfikator zadania jest już używany.' } });
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
      const task = service.createTask(
        request.familyId!,
        request.user!.id,
        id,
        data,
        (request.query as { taskId?: string }).taskId,
      );
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
