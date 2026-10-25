import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError, registerApiErrorHandler } from '../../http/errors.js';
import { registerIdempotentMutations } from '../../http/idempotency.js';
import {
  createShoppingListSchema,
  patchShoppingListSchema,
  createShoppingItemSchema,
  patchShoppingItemSchema,
  shoppingSuggestionsQuerySchema,
  shoppingListsResponseSchema,
  shoppingListResponseSchema,
  shoppingItemsResponseSchema,
  shoppingItemResponseSchema,
  shoppingSuggestionsResponseSchema,
  shoppingDeletedResponseSchema,
  shoppingClearedResponseSchema,
} from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { createShoppingService } from './service.js';

export function registerShoppingRoutes(app: FastifyInstance, database: DatabaseConnection) {
  const service = createShoppingService(database);
  const idSchema = z.object({ id: z.string().uuid() });
  function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Dane żądania są niepoprawne.');
    return parsed.data;
  }
  app.register(async (routes) => {
    registerIdempotentMutations(routes, database, {
      table: 'shopping_operations',
      fingerprintParts: (request) => [request.familyId, request.user!.role, request.method, request.url, request.body],
    });
    registerApiErrorHandler(routes, {
      primaryKeyConflictMessage: 'Identyfikator zmiany jest już używany.',
      internalMessage: 'Nie udało się obsłużyć zakupów.',
      logMessage: 'Shopping request failed',
    });
    routes.get('/api/shopping/lists', async (request) =>
      shoppingListsResponseSchema.parse({ ok: true, lists: service.listLists(request.familyId!, request.user!.id) }),
    );
    routes.post('/api/shopping/lists', (request, reply) => {
      const data = parse(createShoppingListSchema, request.body);
      reply.code(201);
      return shoppingListResponseSchema.parse({
        ok: true,
        list: service.createList(
          request.familyId!,
          request.user!.id,
          request.user!.role,
          data,
          (request.query as { operationId?: string }).operationId,
        ),
      });
    });
    routes.patch('/api/shopping/lists/:id', (request) => {
      const { id } = parse(idSchema, request.params);
      const data = parse(patchShoppingListSchema, request.body);
      return shoppingListResponseSchema.parse({
        ok: true,
        list: service.updateList(request.familyId!, id, request.user!.role, data),
      });
    });
    routes.delete('/api/shopping/lists/:id', (request) => {
      const { id } = parse(idSchema, request.params);
      service.removeList(request.familyId!, id, request.user!.role);
      return shoppingDeletedResponseSchema.parse({ ok: true, deleted: true });
    });
    routes.get('/api/shopping/lists/:id/items', async (request) => {
      const { id } = parse(idSchema, request.params);
      return shoppingItemsResponseSchema.parse({ ok: true, items: service.listItems(request.familyId!, id) });
    });
    routes.post('/api/shopping/lists/:id/items', (request, reply) => {
      const { id } = parse(idSchema, request.params);
      const data = parse(createShoppingItemSchema, request.body);
      reply.code(201);
      return shoppingItemResponseSchema.parse({
        ok: true,
        item: service.createItem(
          request.familyId!,
          id,
          request.user!.id,
          data,
          (request.query as { operationId?: string }).operationId,
        ),
      });
    });
    routes.patch('/api/shopping/items/:id', (request) => {
      const { id } = parse(idSchema, request.params);
      const data = parse(patchShoppingItemSchema, request.body);
      return shoppingItemResponseSchema.parse({
        ok: true,
        item: service.updateItem(request.familyId!, id, request.user!.id, request.user!.role, data),
      });
    });
    routes.delete('/api/shopping/items/:id', (request) => {
      const { id } = parse(idSchema, request.params);
      service.removeItem(request.familyId!, id, request.user!.id, request.user!.role);
      return shoppingDeletedResponseSchema.parse({ ok: true, deleted: true });
    });
    routes.post('/api/shopping/lists/:id/clear-checked', (request) => {
      const { id } = parse(idSchema, request.params);
      return shoppingClearedResponseSchema.parse({
        ok: true,
        deletedCount: service.clearChecked(request.familyId!, id, request.user!.role),
      });
    });
    routes.get('/api/shopping/suggestions', async (request) => {
      const { q } = parse(shoppingSuggestionsQuerySchema, request.query);
      return shoppingSuggestionsResponseSchema.parse({
        ok: true,
        suggestions: service.suggestions(request.familyId!, q),
      });
    });
  });
}
