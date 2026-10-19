import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
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
import { createShoppingService, ShoppingError } from './service.js';

export function registerShoppingRoutes(app: FastifyInstance, database: DatabaseConnection) {
  const service = createShoppingService(database);
  const idSchema = z.object({ id: z.string().uuid() });
  function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new ShoppingError(400, 'VALIDATION_ERROR', 'Dane żądania są niepoprawne.');
    return parsed.data;
  }
  app.register(async (routes) => {
    routes.setErrorHandler((error, _request, reply) => {
      if (error instanceof ShoppingError)
        return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
      if (
        error instanceof Error &&
        'statusCode' in error &&
        typeof error.statusCode === 'number' &&
        error.statusCode < 500
      )
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Dane żądania są niepoprawne.' } });
      routes.log.error({ err: error }, 'Shopping request failed');
      return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Nie udało się obsłużyć zakupów.' } });
    });
    routes.get('/api/shopping/lists', async (request) =>
      shoppingListsResponseSchema.parse({ ok: true, lists: service.listLists(request.familyId!, request.user!.id) }),
    );
    routes.post('/api/shopping/lists', async (request, reply) => {
      const data = parse(createShoppingListSchema, request.body);
      return reply.code(201).send(
        shoppingListResponseSchema.parse({
          ok: true,
          list: service.createList(request.familyId!, request.user!.id, request.user!.role, data),
        }),
      );
    });
    routes.patch('/api/shopping/lists/:id', async (request) => {
      const { id } = parse(idSchema, request.params);
      const data = parse(patchShoppingListSchema, request.body);
      return shoppingListResponseSchema.parse({
        ok: true,
        list: service.updateList(request.familyId!, id, request.user!.role, data),
      });
    });
    routes.delete('/api/shopping/lists/:id', async (request) => {
      const { id } = parse(idSchema, request.params);
      service.removeList(request.familyId!, id, request.user!.role);
      return shoppingDeletedResponseSchema.parse({ ok: true, deleted: true });
    });
    routes.get('/api/shopping/lists/:id/items', async (request) => {
      const { id } = parse(idSchema, request.params);
      return shoppingItemsResponseSchema.parse({ ok: true, items: service.listItems(request.familyId!, id) });
    });
    routes.post('/api/shopping/lists/:id/items', async (request, reply) => {
      const { id } = parse(idSchema, request.params);
      const data = parse(createShoppingItemSchema, request.body);
      return reply.code(201).send(
        shoppingItemResponseSchema.parse({
          ok: true,
          item: service.createItem(request.familyId!, id, request.user!.id, data),
        }),
      );
    });
    routes.patch('/api/shopping/items/:id', async (request) => {
      const { id } = parse(idSchema, request.params);
      const data = parse(patchShoppingItemSchema, request.body);
      return shoppingItemResponseSchema.parse({
        ok: true,
        item: service.updateItem(request.familyId!, id, request.user!.id, request.user!.role, data),
      });
    });
    routes.delete('/api/shopping/items/:id', async (request) => {
      const { id } = parse(idSchema, request.params);
      service.removeItem(request.familyId!, id, request.user!.id, request.user!.role);
      return shoppingDeletedResponseSchema.parse({ ok: true, deleted: true });
    });
    routes.post('/api/shopping/lists/:id/clear-checked', async (request) => {
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
