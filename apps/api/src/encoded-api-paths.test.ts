// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { trustedMutationHeaders } from './test-helpers.js';

const registration = {
  familyName: 'Rodzina',
  displayName: 'Admin',
  email: 'encoded@example.com',
  password: 'password123',
};

describe('API authentication uses matched routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let database: ReturnType<typeof createDatabase>;

  beforeEach(async () => {
    const config = loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' });
    database = createDatabase(config);
    migrate(database.db, { migrationsFolder: './apps/api/drizzle' });
    app = await buildApp(config, database);
    app.get('/api/auth/family-members-extra', () => ({ ok: true }));
    app.post('/api/invitations/new-protected-route', () => ({ ok: true }));
  });

  afterEach(async () => {
    await app.close();
    database.sqlite.close();
  });

  it.each([
    '/%61pi/tasks/today',
    '/ap%69/shopping/lists',
    '/%61pi/events/upcoming-distant',
    '/api/%65vents/upcoming-distant',
    '/ap%69/members',
    '/%61pi/documents',
    '/api/auth/family-members-extra',
    '/%61pi/shopping/lists/00000000-0000-4000-8000-000000000000/items',
  ])('requires a session for GET %s', async (url) => {
    const response = await app.inject({ url });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Brak aktywnej sesji.' } });
  });

  it.each([
    ['POST', '/%61pi/tasks/lists'],
    ['POST', '/ap%69/shopping/lists'],
    ['POST', '/%61pi/events'],
    ['PATCH', '/ap%69/family'],
    ['PATCH', '/api/%66amily'],
    ['POST', '/%61pi/auth/register-family'],
    ['POST', '/ap%69/auth/login'],
    ['POST', '/%61pi/auth/login-child'],
    ['POST', '/ap%69/auth/reset-password'],
    ['POST', '/%61pi/invitations/token/accept'],
  ] as const)('checks the source before session or payload for %s %s', async (method, url) => {
    for (const headers of [{}, { origin: 'https://evil.example' }]) {
      const response = await app.inject({ method, url, headers, payload: {} });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        error: { code: 'FORBIDDEN', message: 'Żądanie pochodzi z niezweryfikowanego źródła.' },
      });
    }
    if (!url.includes('/auth/') && !url.includes('/invitations/')) {
      const response = await app.inject({ method, url, headers: trustedMutationHeaders(), payload: {} });
      expect(response.statusCode).toBe(401);
    }
  });

  it('defaults new API routes to requiring a session, including paths under public prefixes', async () => {
    for (const url of ['/api/invitations', '/api/invitations/new-protected-route']) {
      const response = await app.inject({ method: 'POST', url, headers: trustedMutationHeaders(), payload: {} });
      expect(response.statusCode).toBe(401);
    }
  });

  it('serves encoded public routes with query strings and authenticates encoded protected routes', async () => {
    expect((await app.inject({ url: '/%61pi/health?check=1' })).statusCode).toBe(200);
    const response = await app.inject({
      method: 'POST',
      url: '/%61pi/auth/register-family?check=1',
      headers: trustedMutationHeaders(),
      payload: registration,
    });
    expect(response.statusCode).toBe(201);
    const cookie = String(response.headers['set-cookie']).split(';')[0]!;
    for (const url of ['/%61pi/tasks/today', '/ap%69/shopping/lists', '/%61pi/members']) {
      expect((await app.inject({ url, headers: { cookie } })).statusCode).toBe(200);
    }
    expect(
      (await app.inject({ method: 'POST', url: '/ap%69/shopping/lists', headers: { cookie }, payload: {} })).statusCode,
    ).toBe(403);
  });

  it.each([
    ['POST', '/ap%69/auth/login', 400],
    ['POST', '/%61pi/auth/login-child', 400],
    ['POST', '/ap%69/auth/reset-password', 400],
    ['GET', '/%61pi/auth/family-members?joinCode=invalid', 404],
    ['GET', '/ap%69/invitations/invalid', 404],
    ['POST', '/%61pi/invitations/invalid/accept', 400],
  ] as const)('keeps %s %s public', async (method, url, status) => {
    const response = await app.inject({
      method,
      url,
      headers: trustedMutationHeaders(),
      ...(method === 'POST' ? { payload: {} } : {}),
    });
    expect(response.statusCode).toBe(status);
  });
});

it('does not serve the SPA for missing encoded API resources in production', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'rodzina-paths-'));
  writeFileSync(path.join(directory, 'index.html'), '<html>SPA fallback</html>');
  const config = loadConfig({ NODE_ENV: 'production', RODZINA_DATABASE_PATH: ':memory:', RODZINA_WEB_DIR: directory });
  const database = createDatabase(config);
  migrate(database.db, { migrationsFolder: './apps/api/drizzle' });
  const app = await buildApp(config, database);
  try {
    for (const url of [
      '/api/missing',
      '/%61pi/missing?x=1',
      '/ap%69/missing',
      '/api',
      '/%61pi',
      '/%64ownloads/missing',
    ]) {
      const response = await app.inject({ url });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Nie znaleziono zasobu.' } });
    }
    const page = await app.inject({ url: '/kalendarz' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('SPA fallback');
  } finally {
    await app.close();
    database.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
