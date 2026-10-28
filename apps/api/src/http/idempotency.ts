import { parse } from './validation.js';
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, RouteOptions } from 'fastify';
import { z } from 'zod';
import type { DatabaseConnection } from '../db/client.js';
import { ApiError } from './errors.js';
import { requireUser } from './session-auth.js';

export const OPERATION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const querySchema = z
  .object({
    operationId: z.string().uuid().optional(),
    actorId: z.string().uuid().optional(),
  })
  .strict();

type Options = {
  table: 'shopping_operations' | 'task_operations';
  matches?: (route: RouteOptions) => boolean;
  querySchema?: z.ZodType<{ operationId?: string | undefined; actorId?: string | undefined }>;
  validate?: (request: FastifyRequest) => void;
  fingerprintParts: (request: FastifyRequest) => unknown[];
  resolveScope?: (request: FastifyRequest) => string;
  recheckAccess?: (request: FastifyRequest, scope: string) => void;
};

export function registerIdempotentMutations(app: FastifyInstance, database: DatabaseConnection, options: Options) {
  app.addHook('onRoute', (route) => {
    if (!['POST', 'PATCH', 'DELETE'].includes(String(route.method)) || options.matches?.(route) === false) return;
    const handler = route.handler;
    route.handler = function (request, reply) {
      const user = requireUser(request);
      const { operationId, actorId } = parse(options.querySchema ?? querySchema, request.query);
      if (actorId && actorId !== user.id)
        throw new ApiError(401, 'SESSION_CHANGED', 'Konto zostało zmienione. Zaloguj się ponownie.');
      if (!operationId) return handler.call(this, request, reply);
      options.validate?.(request);
      const fingerprint = createHash('sha256')
        .update(JSON.stringify(options.fingerprintParts(request)))
        .digest('hex');
      return database.sqlite
        .transaction(() => {
          // Table names come only from the closed union above, never from request data.
          const previousOperation = database.sqlite.prepare(
            `SELECT * FROM ${options.table} WHERE user_id = ? AND id = ?`,
          );
          const cleanup = database.sqlite.prepare(`DELETE FROM ${options.table} WHERE created_at < ?`);
          const scoped = options.table === 'task_operations';
          const insert = database.sqlite.prepare(
            scoped
              ? `INSERT INTO ${options.table} (user_id, id, fingerprint, response, status, created_at, list_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
              : `INSERT INTO ${options.table} (user_id, id, fingerprint, response, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
          );
          const now = Date.now();
          cleanup.run(now - OPERATION_RETENTION_MS);
          const previous = previousOperation.get(user.id, operationId) as
            { fingerprint: string; response: string; status: number; list_id: string } | undefined;
          if (previous) {
            options.recheckAccess?.(request, previous.list_id);
            if (previous.fingerprint !== fingerprint)
              throw new ApiError(409, 'OPERATION_CONFLICT', 'Ta zmiana została już wysłana z innymi danymi.');
            reply.code(previous.status);
            return JSON.parse(previous.response);
          }
          const scope = options.resolveScope?.(request);
          // Idempotent mutation handlers MUST be synchronous: better-sqlite3 cannot
          // keep this transaction open across an await or persist a Promise response.
          const response = handler.call(this, request, reply);
          if (
            response !== null &&
            (typeof response === 'object' || typeof response === 'function') &&
            typeof (response as { then?: unknown }).then === 'function'
          ) {
            // Consume rejection as well: the transaction will roll back and the error handler logs the failure.
            void Promise.resolve(response).catch(() => {});
            throw new Error('Idempotent mutation handler returned a thenable; handlers must be synchronous');
          }
          const values = [user.id, operationId, fingerprint, JSON.stringify(response), reply.statusCode, now];
          insert.run(...values, ...(scoped ? [scope] : []));
          return response;
        })
        .immediate();
    };
  });
}
