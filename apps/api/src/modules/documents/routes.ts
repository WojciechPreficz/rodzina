import { routeOptions } from '../../http/route-contract.js';
import { parse } from '../../http/validation.js';
import { requireUser } from '../../http/session-auth.js';
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

import { createDocumentService } from './service.js';

export function registerDocumentRoutes(app: FastifyInstance, database: DatabaseConnection) {
  const service = createDocumentService(database);
  const idSchema = z.object({ id: z.string().uuid() });
  app.register(async (routes) => {
    routes.get('/api/documents', routeOptions({ responses: { 200: documentsResponseSchema } }), async (request) =>
      documentsResponseSchema.parse({
        ok: true,
        documents: service.list(requireUser(request).familyId),
      }),
    );
    routes.post(
      '/api/documents',
      routeOptions({ body: createDocumentSchema, responses: { 201: documentResponseSchema } }, { idempotency: false }),
      (request, reply) => {
        const data = parse(createDocumentSchema, request.body);
        const document = service.create(
          requireUser(request).familyId,
          requireUser(request).id,
          requireUser(request).role,
          data,
        );
        reply.code(201);
        return documentResponseSchema.parse({ ok: true, document });
      },
    );
    routes.patch(
      '/api/documents/:id',
      routeOptions(
        { params: idSchema, body: patchDocumentSchema, responses: { 200: documentResponseSchema } },
        { idempotency: false },
      ),
      (request) => {
        const { id } = parse(idSchema, request.params);
        const data = parse(patchDocumentSchema, request.body);
        return documentResponseSchema.parse({
          ok: true,
          document: service.update(
            requireUser(request).familyId,
            id,
            requireUser(request).id,
            requireUser(request).role,
            data,
          ),
        });
      },
    );
    routes.post(
      '/api/documents/:id/renew',
      routeOptions(
        { params: idSchema, body: renewDocumentSchema, responses: { 200: documentResponseSchema } },
        { idempotency: false },
      ),
      (request) => {
        const { id } = parse(idSchema, request.params);
        const data = parse(renewDocumentSchema, request.body);
        return documentResponseSchema.parse({
          ok: true,
          document: service.update(
            requireUser(request).familyId,
            id,
            requireUser(request).id,
            requireUser(request).role,
            data,
          ),
        });
      },
    );
    routes.delete(
      '/api/documents/:id',
      routeOptions({ params: idSchema, responses: { 200: documentDeletedResponseSchema } }, { idempotency: false }),
      (request) => {
        const { id } = parse(idSchema, request.params);
        service.remove(requireUser(request).familyId, id, requireUser(request).role);
        return documentDeletedResponseSchema.parse({ ok: true, deleted: true });
      },
    );
  });
}
