// @vitest-environment node
import crypto from 'node:crypto';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../db/client.js';
import { loadConfig } from '../config.js';
import * as schema from '../db/schema.js';
import { registerApiErrorHandler } from './errors.js';
import { OPERATION_RETENTION_MS, registerIdempotentMutations } from './idempotency.js';
import { OFFLINE_REPLAY_MAX_AGE_MS } from '@rodzina/shared';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

describe.each(['shopping_operations', 'task_operations'] as const)('%s wrapper', (table) => {
  let database: ReturnType<typeof createDatabase>;
  let app: FastifyInstance;
  const familyId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const listId = crypto.randomUUID();
  beforeEach(() => {
    database = createDatabase(loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' }));
    migrate(database.db, { migrationsFolder });
    database.db.insert(schema.families).values({ id: familyId, name: 'Test', joinCode: familyId, createdAt: 1 }).run();
    database.db
      .insert(schema.users)
      .values({ id: userId, familyId, displayName: 'Test', role: 'admin', createdAt: 1, updatedAt: 1 })
      .run();
    database.db
      .insert(schema.taskLists)
      .values({ id: listId, familyId, ownerId: userId, name: 'Test', createdAt: 1, updatedAt: 1 })
      .run();
    app = Fastify();
    app.addHook('onRequest', async (request) => {
      request.familyId = familyId;
      request.user = { id: userId, familyId } as NonNullable<typeof request.user>;
    });
    registerApiErrorHandler(app);
    registerIdempotentMutations(app, database, {
      table,
      fingerprintParts: (request) => [request.method, request.url, request.body],
      ...(table === 'task_operations' ? { resolveScope: () => listId } : {}),
    });
  });
  afterEach(async () => {
    await app.close();
    database.sqlite.close();
    vi.restoreAllMocks();
  });

  it.each([false, true])(
    'requires a session even without the global auth hook (operationId: %s)',
    async (withOperation) => {
      app.addHook('preHandler', async (request) => {
        delete request.user;
        delete request.familyId;
      });
      const handler = vi.fn(() => ({ ok: true }));
      app.post('/mutation', handler);
      const url = withOperation ? `/mutation?operationId=${crypto.randomUUID()}` : '/mutation';
      const response = await app.inject({ method: 'POST', url });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Brak aktywnej sesji.' } });
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it.each(['async', 'thenable', 'rejected'] as const)(
    'logs and rolls back a %s response instead of persisting a Promise',
    async (kind) => {
      const log = vi.spyOn(app.log, 'error');
      const mutate = () => {
        database.sqlite.prepare('UPDATE families SET name = ? WHERE id = ?').run('Changed', familyId);
        if (kind === 'thenable') return { then: (resolve: (value: object) => void) => resolve({ ok: true }) };
        return kind === 'rejected' ? Promise.reject(new Error('Async failure')) : Promise.resolve({ ok: true });
      };
      app.post('/mutation', kind === 'async' ? async () => mutate() : mutate);
      const response = await app.inject({ method: 'POST', url: `/mutation?operationId=${crypto.randomUUID()}` });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Nie udało się obsłużyć żądania.' },
      });
      expect(log).toHaveBeenCalledWith(
        { err: expect.objectContaining({ message: expect.stringContaining('thenable') }) },
        'API request failed',
      );
      expect(database.sqlite.prepare(`SELECT * FROM ${table}`).all()).toHaveLength(0);
      expect(database.db.select().from(schema.families).get()?.name).toBe('Test');
    },
  );

  it('retains responses through the replay window and deletes only operations older than retention', async () => {
    expect(OPERATION_RETENTION_MS).toBeGreaterThan(OFFLINE_REPLAY_MAX_AGE_MS);
    const handler = vi.fn((_request: FastifyRequest, reply: FastifyReply) => {
      reply.code(201);
      return { result: handler.mock.calls.length };
    });
    app.post('/mutation', handler);
    const old = crypto.randomUUID();
    const retained = crypto.randomUUID();
    const send = (id: string) => app.inject({ method: 'POST', url: `/mutation?operationId=${id}` });
    await send(old);
    const first = await send(retained);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    database.sqlite
      .prepare(`UPDATE ${table} SET created_at = ? WHERE id = ?`)
      .run(now - OPERATION_RETENTION_MS - 1, old);
    database.sqlite
      .prepare(`UPDATE ${table} SET created_at = ? WHERE id = ?`)
      .run(now - OPERATION_RETENTION_MS, retained);
    await send(crypto.randomUUID());
    expect(database.sqlite.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(old)).toBeUndefined();
    const replay = await send(retained);
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    expect(handler).toHaveBeenCalledTimes(3);
    expect(database.sqlite.prepare(`SELECT created_at FROM ${table} WHERE id = ?`).get(retained)).toEqual({
      created_at: now - OPERATION_RETENTION_MS,
    });
  });
});

it('backfills legacy operations with the migration time', () => {
  const database = createDatabase(loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' }));
  try {
    database.sqlite.exec(`
      CREATE TABLE shopping_operations (user_id TEXT, id TEXT, fingerprint TEXT, response TEXT, status INTEGER);
      CREATE TABLE task_operations (user_id TEXT, id TEXT, list_id TEXT, fingerprint TEXT, response TEXT, status INTEGER);
      INSERT INTO shopping_operations VALUES ('user', 'operation', 'hash', '{"ok":true}', 201);
      INSERT INTO task_operations VALUES ('user', 'operation', 'list', 'hash', '{"ok":true}', 201);
    `);
    const before = Date.now() - 1000;
    database.sqlite.exec(readFileSync(path.join(migrationsFolder, '0022_brainy_virginia_dare.sql'), 'utf8'));
    for (const table of ['shopping_operations', 'task_operations']) {
      const row = database.sqlite.prepare(`SELECT created_at, response FROM ${table}`).get() as {
        created_at: number;
        response: string;
      };
      expect(row.created_at).toBeGreaterThanOrEqual(before);
      expect(row.created_at).toBeLessThanOrEqual(Date.now());
      expect(JSON.parse(row.response)).toEqual({ ok: true });
    }
  } finally {
    database.sqlite.close();
  }
});
