import { createTaskChecklistService } from './checklist.js';
import { parse } from '../../http/validation.js';
import { requireUser } from '../../http/session-auth.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../http/errors.js';
import { registerIdempotentMutations } from '../../http/idempotency.js';
import { createTaskListRepository } from './repository.js';
import { createTaskRecurrenceService } from './recurrence.js';
import {
  createTaskChecklistItemSchema,
  patchTaskChecklistItemSchema,
  deleteTaskChecklistItemSchema,
  reorderTaskChecklistSchema,
  taskChecklistResponseSchema,
  createTaskListSchema,
  patchTaskListSchema,
  taskListsResponseSchema,
  taskSnapshotResponseSchema,
  taskListResponseSchema,
  taskListDeletedResponseSchema,
  taskListLeftResponseSchema,
  createTaskSchema,
  patchTaskSchema,
  tasksQuerySchema,
  tasksResponseSchema,
  taskResponseSchema,
  taskDeletedResponseSchema,
  configureTaskSeriesSchema,
  taskSeriesVersionSchema,
  closeTaskOccurrenceSchema,
  taskSeriesResponseSchema,
  taskSeriesHistoryResponseSchema,
} from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { createTaskListService } from './service.js';

export function registerTaskListRoutes(app: FastifyInstance, database: DatabaseConnection) {
  const service = createTaskListService(database);
  const idSchema = z.object({ id: z.string().uuid() });
  app.register(async (routes) => {
    routes.addHook('onRoute', (route) => {
      route.config = { ...route.config, primaryKeyConflictMessage: 'Identyfikator zadania jest już używany.' };
    });
    const repository = createTaskListRepository(database);
    const recurrence = createTaskRecurrenceService(database);
    const checkAccess = (request: import('fastify').FastifyRequest, listId: string) => {
      if (!service.canAccessList(requireUser(request).familyId, requireUser(request).id, listId))
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
      fingerprintParts: (request) => [requireUser(request).familyId, request.method, request.url, request.body],
      resolveScope: (request) => {
        const { id } = parse(idSchema, request.params);
        const listId =
          request.method === 'POST'
            ? id
            : repository.findTask(requireUser(request).familyId, requireUser(request).id, id)?.listId;
        if (!listId) throw new ApiError(404, 'NOT_FOUND', 'Lista zadań nie istnieje.');
        checkAccess(request, listId);
        return listId;
      },
      // Saved responses contain private content; sharing may have changed since the write.
      recheckAccess: checkAccess,
    });
    const recurrenceScope = (request: import('fastify').FastifyRequest) => {
      const user = requireUser(request);
      const { id } = parse(idSchema, request.params);
      if (request.routeOptions.url?.startsWith('/api/tasks/series/'))
        return recurrence.getSeries(user.familyId, user.id, id).listId;
      const task = repository.findTask(user.familyId, user.id, id);
      if (!task) throw new ApiError(404, 'NOT_FOUND', 'Zadanie nie istnieje.');
      return task.listId;
    };
    registerIdempotentMutations(routes, database, {
      table: 'task_operations',
      matches: (route) =>
        route.url.startsWith('/api/tasks/series/') ||
        route.url === '/api/tasks/:id/recurrence' ||
        route.url === '/api/tasks/:id/skip',
      querySchema: z.object({ operationId: z.string().uuid(), actorId: z.string().uuid().optional() }).strict(),
      fingerprintParts: (request) => [requireUser(request).familyId, request.method, request.url, request.body],
      resolveScope: recurrenceScope,
      recheckAccess: (request, listId) => {
        checkAccess(request, listId);
        recurrenceScope(request);
      },
    });
    routes.post('/api/tasks/:id/recurrence', (request, reply) => {
      const user = requireUser(request);
      const { id } = parse(idSchema, request.params);
      const result = recurrence.configure(
        user.familyId,
        user.id,
        id,
        parse(configureTaskSeriesSchema, request.body),
        true,
      );
      reply.code(201);
      return taskSeriesResponseSchema.parse(result);
    });
    routes.patch('/api/tasks/series/:id', (request) => {
      const user = requireUser(request);
      const { id } = parse(idSchema, request.params);
      return taskSeriesResponseSchema.parse(
        recurrence.configure(user.familyId, user.id, id, parse(configureTaskSeriesSchema, request.body), false),
      );
    });
    routes.post('/api/tasks/series/:id/stop', (request) => {
      const user = requireUser(request);
      const { id } = parse(idSchema, request.params);
      return taskSeriesResponseSchema.parse(
        recurrence.stop(user.familyId, user.id, id, parse(taskSeriesVersionSchema, request.body)),
      );
    });
    routes.post('/api/tasks/:id/skip', (request) => {
      const user = requireUser(request);
      const { id } = parse(idSchema, request.params);
      return taskResponseSchema.parse(
        recurrence.skip(user.familyId, user.id, id, parse(closeTaskOccurrenceSchema, request.body)),
      );
    });
    routes.get('/api/tasks/series/:id', (request) => {
      const user = requireUser(request);
      const { id } = parse(idSchema, request.params);
      return taskSeriesResponseSchema.parse(recurrence.read(user.familyId, user.id, id));
    });
    routes.get('/api/tasks/series/:id/history', (request) => {
      const user = requireUser(request);
      const { id } = parse(idSchema, request.params);
      return taskSeriesHistoryResponseSchema.parse(recurrence.history(user.familyId, user.id, id));
    });
    const checklist = createTaskChecklistService(database);
    const checklistParams = z.object({ id: z.string().uuid(), itemId: z.string().uuid().optional() });
    const checkParent = (request: import('fastify').FastifyRequest) => {
      const { id } = parse(checklistParams, request.params);
      const user = requireUser(request);
      return checklist.parent(user.familyId, user.id, id);
    };
    registerIdempotentMutations(routes, database, {
      table: 'task_operations',
      matches: (route) => route.url.startsWith('/api/tasks/:id/checklist'),
      querySchema: z.object({ operationId: z.string().uuid(), actorId: z.string().uuid().optional() }).strict(),
      fingerprintParts: (request) => [requireUser(request).familyId, request.method, request.url, request.body],
      resolveScope: (request) => checkParent(request).listId,
      recheckAccess: (request, listId) => {
        checkAccess(request, listId);
        checkParent(request);
      },
    });
    routes.get('/api/tasks/:id/checklist', (request) => {
      const { id } = parse(checklistParams, request.params);
      const user = requireUser(request);
      return taskChecklistResponseSchema.parse(checklist.read(user.familyId, user.id, id));
    });
    routes.post('/api/tasks/:id/checklist', (request, reply) => {
      const { id } = parse(checklistParams, request.params);
      const data = parse(createTaskChecklistItemSchema, request.body);
      const user = requireUser(request);
      const result = checklist.create(user.familyId, user.id, id, data);
      reply.code(201);
      return taskChecklistResponseSchema.parse(result);
    });
    routes.patch('/api/tasks/:id/checklist/order', (request) => {
      const { id } = parse(checklistParams, request.params);
      const data = parse(reorderTaskChecklistSchema, request.body);
      const user = requireUser(request);
      return taskChecklistResponseSchema.parse(checklist.reorder(user.familyId, user.id, id, data));
    });
    routes.patch('/api/tasks/:id/checklist/:itemId', (request) => {
      const { id, itemId } = parse(checklistParams, request.params);
      const data = parse(patchTaskChecklistItemSchema, request.body);
      const user = requireUser(request);
      return taskChecklistResponseSchema.parse(checklist.change(user.familyId, user.id, id, itemId!, data));
    });
    routes.delete('/api/tasks/:id/checklist/:itemId', (request) => {
      const { id, itemId } = parse(checklistParams, request.params);
      const data = parse(deleteTaskChecklistItemSchema, request.body);
      const user = requireUser(request);
      return taskChecklistResponseSchema.parse(checklist.change(user.familyId, user.id, id, itemId!, data, true));
    });
    routes.get('/api/tasks/snapshot', (request) => {
      const user = requireUser(request);
      repository.ensureDefault(user.familyId, user.id);
      return taskSnapshotResponseSchema.parse(repository.snapshot(user.familyId, user.id));
    });
    routes.get('/api/tasks/lists/:id/tasks', (request) => {
      const { id } = parse(idSchema, request.params);
      const { status } = parse(tasksQuerySchema, request.query);
      return tasksResponseSchema.parse({
        ok: true,
        taskRecurrenceVersion: 1,
        tasks: service.listTasks(requireUser(request).familyId, requireUser(request).id, id, status),
      });
    });
    routes.post('/api/tasks/lists/:id/tasks', (request, reply) => {
      const { id } = parse(idSchema, request.params);
      const data = parse(createTaskSchema, request.body);
      const task = service.createTask(
        requireUser(request).familyId,
        requireUser(request).id,
        id,
        data,
        (request.query as { taskId?: string }).taskId,
      );
      reply.code(201);
      return taskResponseSchema.parse({ ok: true, taskRecurrenceVersion: 1, task });
    });
    routes.patch('/api/tasks/:id', (request) => {
      const { id } = parse(idSchema, request.params);
      const data = parse(patchTaskSchema, request.body);
      return taskResponseSchema.parse({
        ok: true,
        taskRecurrenceVersion: 1,
        task: service.updateTask(requireUser(request).familyId, requireUser(request).id, id, data),
      });
    });
    routes.delete('/api/tasks/:id', (request) => {
      const { id } = parse(idSchema, request.params);
      service.removeTask(requireUser(request).familyId, requireUser(request).id, id);
      return taskDeletedResponseSchema.parse({ ok: true, deleted: true });
    });
    routes.get('/api/tasks/today', (request) =>
      tasksResponseSchema.parse({
        ok: true,
        taskRecurrenceVersion: 1,
        tasks: service.todayTasks(requireUser(request).familyId, requireUser(request).id),
      }),
    );
    routes.get('/api/tasks/lists', async (request) =>
      taskListsResponseSchema.parse({
        ok: true,
        lists: service.listLists(requireUser(request).familyId, requireUser(request).id),
      }),
    );
    routes.post('/api/tasks/lists', (request, reply) => {
      const data = parse(createTaskListSchema, request.body);
      const list = service.createList(requireUser(request).familyId, requireUser(request).id, data);
      reply.code(201);
      return taskListResponseSchema.parse({ ok: true, list });
    });
    routes.patch('/api/tasks/lists/:id', (request) => {
      const { id } = parse(idSchema, request.params);
      const data = parse(patchTaskListSchema, request.body);
      return taskListResponseSchema.parse({
        ok: true,
        list: service.updateList(requireUser(request).familyId, requireUser(request).id, id, data),
      });
    });
    routes.delete('/api/tasks/lists/:id', (request) => {
      const { id } = parse(idSchema, request.params);
      service.removeList(requireUser(request).familyId, requireUser(request).id, id);
      return taskListDeletedResponseSchema.parse({ ok: true, deleted: true });
    });
    routes.post('/api/tasks/lists/:id/leave', (request) => {
      const { id } = parse(idSchema, request.params);
      service.leaveList(requireUser(request).familyId, requireUser(request).id, id);
      return taskListLeftResponseSchema.parse({ ok: true, left: true });
    });
  });
}
