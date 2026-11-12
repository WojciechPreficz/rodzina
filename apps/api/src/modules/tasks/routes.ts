import { routeOptions } from '../../http/route-contract.js';
import { createTaskChecklistService } from './checklist.js';
import { parse } from '../../http/validation.js';
import { requireUser } from '../../http/session-auth.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../http/errors.js';
import type { RegisterIdempotencyProfiles } from '../../http/idempotency.js';
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

export function registerTaskListRoutes(
  app: FastifyInstance,
  database: DatabaseConnection,
  registerProfiles: RegisterIdempotencyProfiles,
) {
  const service = createTaskListService(database);
  const idSchema = z.object({ id: z.guid() });
  app.register(async (routes) => {
    routes.addHook('onRoute', (route) => {
      route.config = { ...route.config, primaryKeyConflictMessage: 'Identyfikator zadania jest już używany.' };
    });
    const recurrence = createTaskRecurrenceService(database);
    const checkAccess = (request: FastifyRequest, listId: string) => {
      if (!service.canAccessList(requireUser(request).familyId, requireUser(request).id, listId))
        throw new ApiError(404, 'NOT_FOUND', 'Lista zadań nie istnieje.');
    };
    const checklist = createTaskChecklistService(database);
    const checklistParams = z.object({ id: z.guid(), itemId: z.guid().optional() });
    const checkParent = (request: FastifyRequest) => {
      const { id } = parse(checklistParams, request.params);
      const user = requireUser(request);
      return checklist.parent(user.familyId, user.id, id);
    };
    const fingerprintParts = (request: FastifyRequest) => [
      requireUser(request).familyId,
      request.method,
      request.url,
      request.body,
    ];
    const requiredOperation = z.object({ operationId: z.guid(), actorId: z.guid().optional() }).strict();
    const occurrenceScope = (request: FastifyRequest) => {
      const user = requireUser(request);
      const { id } = parse(idSchema, request.params);
      const task = service.findTask(user.familyId, user.id, id);
      if (!task) throw new ApiError(404, 'NOT_FOUND', 'Zadanie nie istnieje.');
      return task.listId;
    };
    const seriesScope = (request: FastifyRequest) => {
      const user = requireUser(request);
      const { id } = parse(idSchema, request.params);
      return recurrence.getSeries(user.familyId, user.id, id).listId;
    };
    const scopedProfile = (resolveScope: (request: FastifyRequest) => string) => ({
      table: 'task_operations' as const,
      querySchema: requiredOperation,
      fingerprintParts,
      resolveScope,
      recheckAccess: (request: FastifyRequest, listId: string) => {
        checkAccess(request, listId);
        resolveScope(request);
      },
    });
    const mutation = registerProfiles(routes, {
      'task-entity': {
        table: 'task_operations',
        querySchema: requiredOperation.extend({
          operationId: z.guid().optional(),
          taskId: z.guid().optional(),
        }),
        validate: (request) => {
          if ((request.query as { taskId?: string }).taskId && request.method !== 'POST')
            throw new ApiError(400, 'VALIDATION_ERROR', 'Dane żądania są niepoprawne.');
        },
        fingerprintParts,
        resolveScope: (request) => {
          const { id } = parse(idSchema, request.params);
          const listId =
            request.method === 'POST'
              ? id
              : service.findTask(requireUser(request).familyId, requireUser(request).id, id)?.listId;
          if (!listId) throw new ApiError(404, 'NOT_FOUND', 'Lista zadań nie istnieje.');
          checkAccess(request, listId);
          return listId;
        },
        // Saved responses contain private content; sharing may have changed since the write.
        recheckAccess: checkAccess,
      },
      'task-recurrence': scopedProfile(occurrenceScope),
      'task-series': scopedProfile(seriesScope),
      'task-checklist': scopedProfile((request) => checkParent(request).listId),
    });
    mutation(
      'POST',
      '/api/tasks/:id/recurrence',
      'task-recurrence',
      (request, reply) => {
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
      },
      { params: idSchema, body: configureTaskSeriesSchema, responses: { 201: taskSeriesResponseSchema } },
    );
    mutation(
      'PATCH',
      '/api/tasks/series/:id',
      'task-series',
      (request) => {
        const user = requireUser(request);
        const { id } = parse(idSchema, request.params);
        return taskSeriesResponseSchema.parse(
          recurrence.configure(user.familyId, user.id, id, parse(configureTaskSeriesSchema, request.body), false),
        );
      },
      { params: idSchema, body: configureTaskSeriesSchema, responses: { 200: taskSeriesResponseSchema } },
    );
    mutation(
      'POST',
      '/api/tasks/series/:id/stop',
      'task-series',
      (request) => {
        const user = requireUser(request);
        const { id } = parse(idSchema, request.params);
        return taskSeriesResponseSchema.parse(
          recurrence.stop(user.familyId, user.id, id, parse(taskSeriesVersionSchema, request.body)),
        );
      },
      { params: idSchema, body: taskSeriesVersionSchema, responses: { 200: taskSeriesResponseSchema } },
    );
    mutation(
      'POST',
      '/api/tasks/:id/skip',
      'task-recurrence',
      (request) => {
        const user = requireUser(request);
        const { id } = parse(idSchema, request.params);
        return taskResponseSchema.parse(
          recurrence.skip(user.familyId, user.id, id, parse(closeTaskOccurrenceSchema, request.body)),
        );
      },
      { params: idSchema, body: closeTaskOccurrenceSchema, responses: { 200: taskResponseSchema } },
    );
    routes.get(
      '/api/tasks/series/:id',
      routeOptions({ params: idSchema, responses: { 200: taskSeriesResponseSchema } }),
      (request) => {
        const user = requireUser(request);
        const { id } = parse(idSchema, request.params);
        return taskSeriesResponseSchema.parse(recurrence.read(user.familyId, user.id, id));
      },
    );
    routes.get(
      '/api/tasks/series/:id/history',
      routeOptions({ params: idSchema, responses: { 200: taskSeriesHistoryResponseSchema } }),
      (request) => {
        const user = requireUser(request);
        const { id } = parse(idSchema, request.params);
        return taskSeriesHistoryResponseSchema.parse(recurrence.history(user.familyId, user.id, id));
      },
    );
    routes.get(
      '/api/tasks/:id/checklist',
      routeOptions({ params: checklistParams, responses: { 200: taskChecklistResponseSchema } }),
      (request) => {
        const { id } = parse(checklistParams, request.params);
        const user = requireUser(request);
        return taskChecklistResponseSchema.parse(checklist.read(user.familyId, user.id, id));
      },
    );
    mutation(
      'POST',
      '/api/tasks/:id/checklist',
      'task-checklist',
      (request, reply) => {
        const { id } = parse(checklistParams, request.params);
        const data = parse(createTaskChecklistItemSchema, request.body);
        const user = requireUser(request);
        const result = checklist.create(user.familyId, user.id, id, data);
        reply.code(201);
        return taskChecklistResponseSchema.parse(result);
      },
      { params: checklistParams, body: createTaskChecklistItemSchema, responses: { 201: taskChecklistResponseSchema } },
    );
    mutation(
      'PATCH',
      '/api/tasks/:id/checklist/order',
      'task-checklist',
      (request) => {
        const { id } = parse(checklistParams, request.params);
        const data = parse(reorderTaskChecklistSchema, request.body);
        const user = requireUser(request);
        return taskChecklistResponseSchema.parse(checklist.reorder(user.familyId, user.id, id, data));
      },
      { params: checklistParams, body: reorderTaskChecklistSchema, responses: { 200: taskChecklistResponseSchema } },
    );
    mutation(
      'PATCH',
      '/api/tasks/:id/checklist/:itemId',
      'task-checklist',
      (request) => {
        const { id, itemId } = parse(checklistParams, request.params);
        const data = parse(patchTaskChecklistItemSchema, request.body);
        const user = requireUser(request);
        return taskChecklistResponseSchema.parse(checklist.change(user.familyId, user.id, id, itemId!, data));
      },
      { params: checklistParams, body: patchTaskChecklistItemSchema, responses: { 200: taskChecklistResponseSchema } },
    );
    mutation(
      'DELETE',
      '/api/tasks/:id/checklist/:itemId',
      'task-checklist',
      (request) => {
        const { id, itemId } = parse(checklistParams, request.params);
        const data = parse(deleteTaskChecklistItemSchema, request.body);
        const user = requireUser(request);
        return taskChecklistResponseSchema.parse(checklist.change(user.familyId, user.id, id, itemId!, data, true));
      },
      { params: checklistParams, body: deleteTaskChecklistItemSchema, responses: { 200: taskChecklistResponseSchema } },
    );
    routes.get('/api/tasks/snapshot', routeOptions({ responses: { 200: taskSnapshotResponseSchema } }), (request) => {
      const user = requireUser(request);
      service.ensureDefault(user.familyId, user.id);
      return taskSnapshotResponseSchema.parse(service.snapshot(user.familyId, user.id));
    });
    routes.get(
      '/api/tasks/lists/:id/tasks',
      routeOptions({ params: idSchema, query: tasksQuerySchema, responses: { 200: tasksResponseSchema } }),
      (request) => {
        const { id } = parse(idSchema, request.params);
        const { status } = parse(tasksQuerySchema, request.query);
        return tasksResponseSchema.parse({
          ok: true,
          taskRecurrenceVersion: 1,
          tasks: service.listTasks(requireUser(request).familyId, requireUser(request).id, id, status),
        });
      },
    );
    mutation(
      'POST',
      '/api/tasks/lists/:id/tasks',
      'task-entity',
      (request, reply) => {
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
      },
      { params: idSchema, body: createTaskSchema, responses: { 201: taskResponseSchema } },
    );
    mutation(
      'PATCH',
      '/api/tasks/:id',
      'task-entity',
      (request) => {
        const { id } = parse(idSchema, request.params);
        const data = parse(patchTaskSchema, request.body);
        return taskResponseSchema.parse({
          ok: true,
          taskRecurrenceVersion: 1,
          task: service.updateTask(requireUser(request).familyId, requireUser(request).id, id, data),
        });
      },
      { params: idSchema, body: patchTaskSchema, responses: { 200: taskResponseSchema } },
    );
    mutation(
      'DELETE',
      '/api/tasks/:id',
      'task-entity',
      (request) => {
        const { id } = parse(idSchema, request.params);
        service.removeTask(requireUser(request).familyId, requireUser(request).id, id);
        return taskDeletedResponseSchema.parse({ ok: true, deleted: true });
      },
      { params: idSchema, responses: { 200: taskDeletedResponseSchema } },
    );
    routes.get('/api/tasks/today', routeOptions({ responses: { 200: tasksResponseSchema } }), (request) =>
      tasksResponseSchema.parse({
        ok: true,
        taskRecurrenceVersion: 1,
        tasks: service.todayTasks(requireUser(request).familyId, requireUser(request).id),
      }),
    );
    routes.get('/api/tasks/lists', routeOptions({ responses: { 200: taskListsResponseSchema } }), async (request) =>
      taskListsResponseSchema.parse({
        ok: true,
        lists: service.listLists(requireUser(request).familyId, requireUser(request).id),
      }),
    );
    routes.post(
      '/api/tasks/lists',
      routeOptions({ body: createTaskListSchema, responses: { 201: taskListResponseSchema } }, { idempotency: false }),
      (request, reply) => {
        const data = parse(createTaskListSchema, request.body);
        const list = service.createList(requireUser(request).familyId, requireUser(request).id, data);
        reply.code(201);
        return taskListResponseSchema.parse({ ok: true, list });
      },
    );
    routes.patch(
      '/api/tasks/lists/:id',
      routeOptions(
        { params: idSchema, body: patchTaskListSchema, responses: { 200: taskListResponseSchema } },
        { idempotency: false },
      ),
      (request) => {
        const { id } = parse(idSchema, request.params);
        const data = parse(patchTaskListSchema, request.body);
        return taskListResponseSchema.parse({
          ok: true,
          list: service.updateList(requireUser(request).familyId, requireUser(request).id, id, data),
        });
      },
    );
    routes.delete(
      '/api/tasks/lists/:id',
      routeOptions({ params: idSchema, responses: { 200: taskListDeletedResponseSchema } }, { idempotency: false }),
      (request) => {
        const { id } = parse(idSchema, request.params);
        service.removeList(requireUser(request).familyId, requireUser(request).id, id);
        return taskListDeletedResponseSchema.parse({ ok: true, deleted: true });
      },
    );
    routes.post(
      '/api/tasks/lists/:id/leave',
      routeOptions({ params: idSchema, responses: { 200: taskListLeftResponseSchema } }, { idempotency: false }),
      (request) => {
        const { id } = parse(idSchema, request.params);
        service.leaveList(requireUser(request).familyId, requireUser(request).id, id);
        return taskListLeftResponseSchema.parse({ ok: true, left: true });
      },
    );
  });
}
