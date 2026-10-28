import type { FastifyInstance } from 'fastify';
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
} from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { parse } from '../../http/validation.js';
import { requireUser } from '../../http/session-auth.js';
import { createMealService } from './service.js';

export function registerMealRoutes(app: FastifyInstance, database: DatabaseConnection) {
  const service = createMealService(database);
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
