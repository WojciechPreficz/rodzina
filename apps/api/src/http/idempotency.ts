import { parse } from './validation.js';
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
import { z } from 'zod';
import type { DatabaseConnection } from '../db/client.js';
import { OPERATION_RETENTION_MS } from '../db/operation-retention.js';
import { ApiError } from './errors.js';
import { requireUser } from './session-auth.js';

const querySchema = z
  .object({
    operationId: z.string().uuid().optional(),
    actorId: z.string().uuid().optional(),
  })
  .strict();

declare module 'fastify' {
  interface FastifyContextConfig {
    idempotency?: string | false;
  }
}

type Profile = {
  table: 'shopping_operations' | 'task_operations';
  querySchema?: z.ZodType<{ operationId?: string | undefined; actorId?: string | undefined }>;
  validate?: (request: FastifyRequest) => void;
  fingerprintParts: (request: FastifyRequest) => unknown[];
  resolveScope?: (request: FastifyRequest) => string;
  recheckAccess?: (request: FastifyRequest, scope: string) => void;
};

type MutationMethod = 'POST' | 'PATCH' | 'DELETE';
type SyncResponse = (object & { then?: never }) | string | number | boolean | null | undefined;
type SyncHandler = (this: FastifyInstance, request: FastifyRequest, reply: FastifyReply) => SyncResponse;
const wrappedHandlers = new WeakSet<RouteOptions['handler']>();

export type RegisterIdempotencyProfiles = ReturnType<typeof registerIdempotency>;

export function registerIdempotency(app: FastifyInstance, database: DatabaseConnection) {
  const profiles = new Map<string, Profile>();
  const unusedProfiles = new Set<string>();

  app.addHook('onRoute', (route) => {
    const name = route.config?.idempotency;
    if (name === undefined || name === false) return;
    const options = profiles.get(name);
    if (!options) throw new Error(`Unknown idempotency profile "${name}" for ${route.method} ${route.url}`);
    if (![route.method].flat().every((method) => ['POST', 'PATCH', 'DELETE'].includes(method))) {
      throw new Error(`Idempotency profile "${name}" cannot be used for ${route.method} ${route.url}`);
    }
    const handler = route.handler;
    if (wrappedHandlers.has(handler)) throw new Error(`Idempotency already applied to ${route.method} ${route.url}`);
    unusedProfiles.delete(name);
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
    wrappedHandlers.add(route.handler);
  });

  app.addHook('onReady', async () => {
    if (unusedProfiles.size) throw new Error(`Unused idempotency profiles: ${[...unusedProfiles].join(', ')}`);
  });

  return function registerProfiles<Name extends string>(routes: FastifyInstance, definitions: Record<Name, Profile>) {
    for (const name in definitions) {
      if (profiles.has(name)) throw new Error(`Duplicate idempotency profile "${name}"`);
      profiles.set(name, definitions[name]);
      unusedProfiles.add(name);
    }
    return (method: MutationMethod, url: string, idempotency: Name, handler: SyncHandler) => {
      routes.route({ method, url, config: { idempotency }, handler });
    };
  };
}
