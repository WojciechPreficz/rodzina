import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
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
    // Persist the response in the same transaction as the write. A retry after
    // losing the response must not add twice or clear newly checked products.
    routes.addHook('onRoute', (options) => {
      if (!['POST', 'PATCH', 'DELETE'].includes(String(options.method))) return;
      const handler = options.handler;
      options.handler = function (request, reply) {
        const { operationId, actorId } = parse(
          z.object({ operationId: z.string().uuid().optional(), actorId: z.string().uuid().optional() }).strict(),
          request.query,
        );
        if (actorId && actorId !== request.user!.id)
          throw new ShoppingError(401, 'SESSION_CHANGED', 'Konto zostało zmienione. Zaloguj się ponownie.');
        if (!operationId) return handler.call(this, request, reply);
        const fingerprint = createHash('sha256')
          .update(JSON.stringify([request.familyId, request.user!.role, request.method, request.url, request.body]))
          .digest('hex');
        return database.sqlite
          .transaction(() => {
            const previous = database.sqlite
              .prepare('SELECT fingerprint, response, status FROM shopping_operations WHERE user_id = ? AND id = ?')
              .get(request.user!.id, operationId) as
              { fingerprint: string; response: string; status: number } | undefined;
            if (previous) {
              if (previous.fingerprint !== fingerprint)
                throw new ShoppingError(409, 'OPERATION_CONFLICT', 'Ta zmiana została już wysłana z innymi danymi.');
              reply.code(previous.status);
              return JSON.parse(previous.response);
            }
            const response = handler.call(this, request, reply);
            database.sqlite
              .prepare(
                'INSERT INTO shopping_operations (user_id, id, fingerprint, response, status) VALUES (?, ?, ?, ?, ?)',
              )
              .run(request.user!.id, operationId, fingerprint, JSON.stringify(response), reply.statusCode);
            return response;
          })
          .immediate();
      };
    });
    routes.setErrorHandler((error, _request, reply) => {
      if (error instanceof ShoppingError)
        return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
      if (error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY')
        return reply
          .code(409)
          .send({ error: { code: 'OPERATION_CONFLICT', message: 'Identyfikator zmiany jest już używany.' } });
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
