// @vitest-environment node
import crypto from 'node:crypto';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashToken } from '../auth.js';
import { loadConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import * as schema from '../db/schema.js';

describe('HTTP boundary across API modules', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let database: ReturnType<typeof createDatabase>;
  let cookie: string;

  beforeEach(async () => {
    const config = loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' });
    database = createDatabase(config);
    migrate(database.db, { migrationsFolder: './apps/api/drizzle' });
    const familyId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const token = crypto.randomUUID();
    database.db.insert(schema.families).values({ id: familyId, name: 'Test', joinCode: familyId, createdAt: 1 }).run();
    database.db
      .insert(schema.users)
      .values({ id: userId, familyId, displayName: 'Admin', role: 'admin', createdAt: 1, updatedAt: 1 })
      .run();
    database.db
      .insert(schema.sessions)
      .values({ id: hashToken(token), userId, createdAt: Date.now(), expiresAt: Date.now() + 86400000 })
      .run();
    cookie = `sid=${token}`;
    app = await buildApp(config, database);
  });
  afterEach(async () => {
    await app.close();
    database.sqlite.close();
  });

  describe.each([
    '/api/auth/login',
    '/api/members/child',
    '/api/events',
    '/api/shopping/lists',
    '/api/tasks/lists',
    '/api/documents',
    '/api/contacts',
    '/api/reminders/mine',
  ])('%s', (url) => {
    it.each([
      ['malformed JSON', '{', 'application/json', 400, 'VALIDATION_ERROR'],
      ['empty JSON', '', 'application/json', 400, 'VALIDATION_ERROR'],
      [
        'oversized body',
        JSON.stringify({ data: 'x'.repeat(1024 * 1024) }),
        'application/json',
        413,
        'PAYLOAD_TOO_LARGE',
      ],
      ['unsupported media type', '<xml/>', 'application/xml', 415, 'UNSUPPORTED_MEDIA_TYPE'],
      ['invalid fields', '{}', 'application/json', 400, 'VALIDATION_ERROR'],
    ] as const)('normalizes %s', async (_name, payload, contentType, status, code) => {
      const response = await app.inject({
        method: 'POST',
        url,
        payload,
        headers: { cookie, origin: 'http://localhost:3000', host: 'localhost:3000', 'content-type': contentType },
      });
      expect(response.statusCode, response.body).toBe(status);
      expect(response.json()).toEqual({ error: { code, message: expect.any(String) } });
      expect(response.json().error.message).not.toMatch(/JSON|Unexpected|Unsupported|too large/);
    });
  });

  it('normalizes missing routes', async () => {
    const response = await app.inject('/api/missing');
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Nie znaleziono zasobu.' } });
  });

  it('uses the global handler for errors on the public health route', async () => {
    app.addHook('preHandler', async (request) => {
      if (request.routeOptions.url === '/api/health') throw new Error('Private infrastructure details');
    });
    const response = await app.inject('/api/health');
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Nie udało się obsłużyć żądania.' } });
  });
});
