import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createDocumentSchema,
  patchDocumentSchema,
  renewDocumentSchema,
  documentResponseSchema,
  documentsResponseSchema,
  documentDeletedResponseSchema,
} from '@rodzina/shared';
import type { DatabaseConnection } from '../../db/client.js';
import { ApiError, registerApiErrorHandler } from '../../http/errors.js';
import { createDocumentService } from './service.js';

export function registerDocumentRoutes(app: FastifyInstance, database: DatabaseConnection) {
  const service = createDocumentService(database);
  const idSchema = z.object({ id: z.string().uuid() });
  function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) throw new ApiError(400, 'VALIDATION_ERROR', 'Dane dokumentu są niepoprawne.');
    return result.data;
  }
  app.register(async (routes) => {
    registerApiErrorHandler(routes, {
      internalMessage: 'Nie udało się obsłużyć dokumentów.',
      logMessage: 'Document request failed',
    });
    routes.get('/api/documents', async (request) =>
      documentsResponseSchema.parse({
        ok: true,
        documents: service.list(request.familyId!),
      }),
    );
    routes.post('/api/documents', (request, reply) => {
      const data = parse(createDocumentSchema, request.body);
      const document = service.create(request.familyId!, request.user!.id, request.user!.role, data);
      reply.code(201);
      return documentResponseSchema.parse({ ok: true, document });
    });
    routes.patch('/api/documents/:id', (request) => {
      const { id } = parse(idSchema, request.params);
      const data = parse(patchDocumentSchema, request.body);
      return documentResponseSchema.parse({
        ok: true,
        document: service.update(request.familyId!, id, request.user!.id, request.user!.role, data),
      });
    });
    routes.post('/api/documents/:id/renew', (request) => {
      const { id } = parse(idSchema, request.params);
      const data = parse(renewDocumentSchema, request.body);
      return documentResponseSchema.parse({
        ok: true,
        document: service.update(request.familyId!, id, request.user!.id, request.user!.role, data),
      });
    });
    routes.delete('/api/documents/:id', (request) => {
      const { id } = parse(idSchema, request.params);
      service.remove(request.familyId!, id, request.user!.role);
      return documentDeletedResponseSchema.parse({ ok: true, deleted: true });
    });
  });
}
