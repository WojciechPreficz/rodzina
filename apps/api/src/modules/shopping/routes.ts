import { parse } from '../../http/validation.js';
import { requireUser } from '../../http/session-auth.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

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
  app.register(async (routes) => {
    routes.addHook('onRoute', (route) => {
      route.config = { ...route.config, primaryKeyConflictMessage: 'Identyfikator zmiany jest już używany.' };
    });
    registerIdempotentMutations(routes, database, {
      table: 'shopping_operations',
      fingerprintParts: (request) => [
        requireUser(request).familyId,
        requireUser(request).role,
        request.method,
        request.url,
        request.body,
      ],
    });
    routes.get('/api/shopping/lists', async (request) =>
      shoppingListsResponseSchema.parse({
        ok: true,
        lists: service.listLists(requireUser(request).familyId, requireUser(request).id),
      }),
    );
    routes.post('/api/shopping/lists', (request, reply) => {
      const data = parse(createShoppingListSchema, request.body);
      reply.code(201);
      return shoppingListResponseSchema.parse({
        ok: true,
        list: service.createList(
          requireUser(request).familyId,
          requireUser(request).id,
          requireUser(request).role,
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
        list: service.updateList(requireUser(request).familyId, id, requireUser(request).role, data),
      });
    });
    routes.delete('/api/shopping/lists/:id', (request) => {
      const { id } = parse(idSchema, request.params);
      service.removeList(requireUser(request).familyId, id, requireUser(request).role);
      return shoppingDeletedResponseSchema.parse({ ok: true, deleted: true });
    });
    routes.get('/api/shopping/lists/:id/items', async (request) => {
      const { id } = parse(idSchema, request.params);
      return shoppingItemsResponseSchema.parse({
        ok: true,
        items: service.listItems(requireUser(request).familyId, id),
      });
    });
    routes.post('/api/shopping/lists/:id/items', (request, reply) => {
      const { id } = parse(idSchema, request.params);
      const data = parse(createShoppingItemSchema, request.body);
      reply.code(201);
      return shoppingItemResponseSchema.parse({
        ok: true,
        item: service.createItem(
          requireUser(request).familyId,
          id,
          requireUser(request).id,
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
        item: service.updateItem(
          requireUser(request).familyId,
          id,
          requireUser(request).id,
          requireUser(request).role,
          data,
        ),
      });
    });
    routes.delete('/api/shopping/items/:id', (request) => {
      const { id } = parse(idSchema, request.params);
      service.removeItem(requireUser(request).familyId, id, requireUser(request).id, requireUser(request).role);
      return shoppingDeletedResponseSchema.parse({ ok: true, deleted: true });
    });
    routes.post('/api/shopping/lists/:id/clear-checked', (request) => {
      const { id } = parse(idSchema, request.params);
      return shoppingClearedResponseSchema.parse({
        ok: true,
        deletedCount: service.clearChecked(requireUser(request).familyId, id, requireUser(request).role),
      });
    });
    routes.get('/api/shopping/suggestions', async (request) => {
      const { q } = parse(shoppingSuggestionsQuerySchema, request.query);
      return shoppingSuggestionsResponseSchema.parse({
        ok: true,
        suggestions: service.suggestions(requireUser(request).familyId, q),
      });
    });
  });
}
