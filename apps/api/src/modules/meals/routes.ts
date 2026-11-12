import { routeOptions } from '../../http/route-contract.js';
import { requireAdult } from '../../http/require-adult.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
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
  mealOfflineWriteChangeSchema,
} from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { parse } from '../../http/validation.js';
import { requireUser } from '../../http/session-auth.js';
import { createMealService } from './service.js';
import type { RegisterIdempotencyProfiles } from '../../http/idempotency.js';

const mealOfflineResponseSchema = z.object({ ok: z.literal(true), week: mealWeekResponseSchema });
const mealDeletedResponseSchema = z.object({ ok: z.literal(true), deleted: z.literal(true) });

export function registerMealRoutes(
  app: FastifyInstance,
  database: DatabaseConnection,
  registerProfiles: RegisterIdempotencyProfiles,
) {
  const service = createMealService(database);
  const checkExportAccess = (request: FastifyRequest) => {
    const user = requireUser(request);
    service.requireExportAccess(user.familyId, user.role, parse(mealsToShoppingListSchema, request.body).listId);
  };
  const mutation = registerProfiles(app, {
    'meal-offline': {
      table: 'shopping_operations',
      querySchema: z.object({ operationId: z.guid(), actorId: z.guid() }).strict(),
      validate: (request) => {
        requireAdult(requireUser(request).role);
        parse(mealOfflineChangeSchema, request.body);
      },
      recheckAccess: (request) => requireAdult(requireUser(request).role),
      fingerprintParts: (request) => [requireUser(request).familyId, request.url, request.body],
    },
    'meal-export': {
      table: 'shopping_operations',
      querySchema: z.object({ operationId: z.guid(), actorId: z.guid().optional() }).strict(),
      validate: checkExportAccess,
      recheckAccess: checkExportAccess,
      fingerprintParts: (request) => [requireUser(request).familyId, request.method, request.url, request.body],
    },
  });
  mutation(
    'POST',
    '/api/meals/offline',
    'meal-offline',
    (request) => {
      const user = requireUser(request);
      return service.offline(user.familyId, user.id, user.role, parse(mealOfflineChangeSchema, request.body));
    },
    { body: mealOfflineWriteChangeSchema, responses: { 200: mealOfflineResponseSchema } },
  );
  mutation(
    'POST',
    '/api/meals/to-shopping-list',
    'meal-export',
    (request) => {
      const user = requireUser(request);
      return mealsToShoppingListResponseSchema.parse({
        ok: true,
        ...service.toShoppingList(user.familyId, user.id, user.role, parse(mealsToShoppingListSchema, request.body)),
      });
    },
    {
      body: mealsToShoppingListSchema,
      responses: { 200: mealsToShoppingListResponseSchema },
      description:
        'Ponowienie tego samego żądania zachowuje wynik. Świadome powtórzenie eksportu wymaga potwierdzenia.',
    },
  );
  app.get(
    '/api/meals',
    routeOptions({ query: mealWeekQuerySchema, responses: { 200: mealWeekResponseSchema } }),
    (request) => {
      const user = requireUser(request);
      const { weekStart, multiple } = parse(mealWeekQuerySchema, request.query);
      return mealWeekResponseSchema.parse({ ok: true, ...service.week(user.familyId, weekStart, multiple === 'true') });
    },
  );
  app.get(
    '/api/meals/suggestions',
    routeOptions({ query: mealSuggestionsQuerySchema, responses: { 200: mealSuggestionsResponseSchema } }),
    (request) => {
      const user = requireUser(request);
      const { q } = parse(mealSuggestionsQuerySchema, request.query);
      return mealSuggestionsResponseSchema.parse({ ok: true, suggestions: service.suggestions(user.familyId, q) });
    },
  );
  app.put(
    '/api/meals/:date/:slot',
    routeOptions(
      { params: mealParamsSchema, body: putMealSchema, responses: { 200: mealResponseSchema } },
      { idempotency: false },
    ),
    (request) => {
      const user = requireUser(request);
      const { date } = parse(mealParamsSchema, request.params);
      const data = parse(putMealSchema, request.body);
      return mealResponseSchema.parse({ ok: true, meal: service.put(user.familyId, user.id, user.role, date, data) });
    },
  );
  app.delete(
    '/api/meals/:date/:slot',
    routeOptions({ params: mealParamsSchema, responses: { 200: mealDeletedResponseSchema } }, { idempotency: false }),
    (request) => {
      const user = requireUser(request);
      service.remove(user.familyId, user.role, parse(mealParamsSchema, request.params).date);
      return { ok: true, deleted: true };
    },
  );
  app.post(
    '/api/meals/copy-week',
    routeOptions({ body: copyMealWeekSchema, responses: { 200: copyMealWeekResponseSchema } }, { idempotency: false }),
    (request) => {
      const user = requireUser(request);
      const data = parse(copyMealWeekSchema, request.body);
      return copyMealWeekResponseSchema.parse({
        ok: true,
        copied: service.copy(user.familyId, user.id, user.role, data),
      });
    },
  );
}
