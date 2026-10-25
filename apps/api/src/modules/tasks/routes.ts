import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError, registerApiErrorHandler } from '../../http/errors.js';
import { registerIdempotentMutations } from '../../http/idempotency.js';
import { createTaskListRepository } from './repository.js';
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
import { createTaskListService } from './service.js';

export function registerTaskListRoutes(app: FastifyInstance, database: DatabaseConnection) {
  const service = createTaskListService(database);
  const idSchema = z.object({ id: z.string().uuid() });
  function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Dane żądania są niepoprawne.');
    return parsed.data;
  }
  app.register(async (routes) => {
    const repository = createTaskListRepository(database);
    const checkAccess = (request: import('fastify').FastifyRequest, listId: string) => {
      if (!service.canAccessList(request.familyId!, request.user!.id, listId))
        throw new ApiError(404, 'NOT_FOUND', 'Lista zadań nie istnieje.');
    };
    registerIdempotentMutations(routes, database, {
      table: 'task_operations',
      matches: (route) => route.url === '/api/tasks/lists/:id/tasks' || route.url === '/api/tasks/:id',
      querySchema: z
        .object({
          operationId: z.string().uuid().optional(),
          actorId: z.string().uuid().optional(),
          taskId: z.string().uuid().optional(),
        })
        .strict(),
      validate: (request) => {
        if ((request.query as { taskId?: string }).taskId && request.method !== 'POST')
          throw new ApiError(400, 'VALIDATION_ERROR', 'Dane żądania są niepoprawne.');
      },
      fingerprintParts: (request) => [request.familyId, request.method, request.url, request.body],
      resolveScope: (request) => {
        const { id } = parse(idSchema, request.params);
        const listId =
          request.method === 'POST' ? id : repository.findTask(request.familyId!, request.user!.id, id)?.listId;
        if (!listId) throw new ApiError(404, 'NOT_FOUND', 'Lista zadań nie istnieje.');
        checkAccess(request, listId);
        return listId;
      },
      // Saved responses contain private content; sharing may have changed since the write.
      recheckAccess: checkAccess,
    });
    registerApiErrorHandler(routes, {
      primaryKeyConflictMessage: 'Identyfikator zadania jest już używany.',
      internalMessage: 'Nie udało się obsłużyć zadań.',
      logMessage: 'Task request failed',
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
