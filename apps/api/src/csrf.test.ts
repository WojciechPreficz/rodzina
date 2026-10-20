// @vitest-environment node
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { trustedMutationHeaders } from './test-helpers.js';

describe('API mutation source verification', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let database: ReturnType<typeof createDatabase>;

  beforeEach(async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      RODZINA_DATABASE_PATH: ':memory:',
      RODZINA_ALLOW_REGISTRATION: 'true',
    });
    database = createDatabase(config);
    migrate(database.db, { migrationsFolder: './apps/api/drizzle' });
    app = await buildApp(config, database);
    app.post('/outside-api', async () => ({ ok: true }));
  });

  afterEach(async () => {
    await app.close();
    database.sqlite.close();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)('rejects %s without Origin and Referer', async (method) => {
    const response = await app.inject({ method, url: '/api/auth/logout' });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: { code: 'FORBIDDEN', message: 'Żądanie pochodzi z niezweryfikowanego źródła.' },
    });
  });

  it.each([{ host: 'localhost:3000', referer: 'http://localhost:3000/login?next=calendar' }, trustedMutationHeaders()])(
    'allows registration and authenticated logout from trusted sources: %j',
    async (headers) => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register-family',
        headers,
        payload: { familyName: 'Rodzina', displayName: 'Admin', email: 'csrf@example.com', password: 'password123' },
      });
      expect(response.statusCode).toBe(201);
      const cookie = String(response.headers['set-cookie']).split(';')[0]!;
      expect(
        (await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...headers, cookie } })).statusCode,
      ).toBe(200);
    },
  );

  it.each([
    { host: 'localhost:3000', origin: 'https://evil.example' },
    { host: 'localhost:3000', referer: 'https://evil.example/' },
    { host: 'localhost:3000', origin: 'https://evil.example', referer: 'http://localhost:3000/' },
  ])('rejects untrusted sources on public routes: %j', async (headers) => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: {} });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('preserves public and protected GET behavior without source headers', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    const response = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('does not apply API source verification outside /api/', async () => {
    expect((await app.inject({ method: 'POST', url: '/outside-api' })).statusCode).toBe(200);
  });
});
