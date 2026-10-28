import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  copyMealWeekSchema,
  copyMealWeekResponseSchema,
  mealParamsSchema,
  mealResponseSchema,
  mealSuggestionsQuerySchema,
  mealSuggestionsResponseSchema,
  mealWeekQuerySchema,
  mealWeekResponseSchema,
  putMealSchema,
  mealsToShoppingListSchema,
  mealsToShoppingListResponseSchema,
  mealOfflineChangeSchema,
} from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { parse } from '../../http/validation.js';
import { requireUser } from '../../http/session-auth.js';
import { createMealService } from './service.js';
import { registerIdempotentMutations } from '../../http/idempotency.js';

export function registerMealRoutes(app: FastifyInstance, database: DatabaseConnection) {
  const service = createMealService(database);
  app.register(async (routes) => {
    registerIdempotentMutations(routes, database, {
      table: 'shopping_operations',
      querySchema: z.object({ operationId: z.string().uuid(), actorId: z.string().uuid() }).strict(),
      validate: (request) => {
        service.requireAdult(requireUser(request).role);
        parse(mealOfflineChangeSchema, request.body);
      },
      recheckAccess: (request) => service.requireAdult(requireUser(request).role),
      fingerprintParts: (request) => [requireUser(request).familyId, request.url, request.body],
    });
    routes.post('/api/meals/offline', (request) => {
      const user = requireUser(request);
      return service.offline(user.familyId, user.id, user.role, parse(mealOfflineChangeSchema, request.body));
    });
  });
  app.register(async (routes) => {
    registerIdempotentMutations(routes, database, {
      table: 'shopping_operations',
      querySchema: z.object({ operationId: z.string().uuid(), actorId: z.string().uuid().optional() }).strict(),
      validate: (request) => {
        const user = requireUser(request);
        service.requireExportAccess(user.familyId, user.role, parse(mealsToShoppingListSchema, request.body).listId);
      },
      recheckAccess: (request) => {
        const user = requireUser(request);
        service.requireExportAccess(user.familyId, user.role, parse(mealsToShoppingListSchema, request.body).listId);
      },
      fingerprintParts: (request) => [requireUser(request).familyId, request.method, request.url, request.body],
    });
    routes.post('/api/meals/to-shopping-list', (request) => {
      const user = requireUser(request);
      return mealsToShoppingListResponseSchema.parse({
        ok: true,
        ...service.toShoppingList(user.familyId, user.id, user.role, parse(mealsToShoppingListSchema, request.body)),
      });
    });
  });
  app.get('/api/meals', (request) => {
    const user = requireUser(request);
    const { weekStart } = parse(mealWeekQuerySchema, request.query);
    return mealWeekResponseSchema.parse({ ok: true, ...service.week(user.familyId, weekStart) });
  });
  app.get('/api/meals/suggestions', (request) => {
    const user = requireUser(request);
    const { q } = parse(mealSuggestionsQuerySchema, request.query);
    return mealSuggestionsResponseSchema.parse({ ok: true, suggestions: service.suggestions(user.familyId, q) });
  });
  app.put('/api/meals/:date/:slot', (request) => {
    const user = requireUser(request);
    const { date } = parse(mealParamsSchema, request.params);
    const data = parse(putMealSchema, request.body);
    return mealResponseSchema.parse({ ok: true, meal: service.put(user.familyId, user.id, user.role, date, data) });
  });
  app.delete('/api/meals/:date/:slot', (request) => {
    const user = requireUser(request);
    service.remove(user.familyId, user.role, parse(mealParamsSchema, request.params).date);
    return { ok: true, deleted: true };
  });
  app.post('/api/meals/copy-week', (request) => {
    const user = requireUser(request);
    const data = parse(copyMealWeekSchema, request.body);
    return copyMealWeekResponseSchema.parse({
      ok: true,
      copied: service.copy(user.familyId, user.id, user.role, data),
    });
  });
}
