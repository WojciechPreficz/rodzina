import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import * as schema from './db/schema.js';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');

function getSessionHeader(response: { headers: Record<string, string | string[] | undefined> }): string {
  const setCookie = response.headers['set-cookie'];
  if (Array.isArray(setCookie)) {
    return setCookie[0];
  }

  if (typeof setCookie === 'string') {
    return setCookie.split(';')[0];
  }

  return '';
}

async function createTestApp(overrides?: Record<string, string>) {
  const config = loadConfig({
    NODE_ENV: 'test',
    RODZINA_DATABASE_PATH: ':memory:',
    RODZINA_PUBLIC_URL: 'http://localhost:3000',
    RODZINA_ALLOW_REGISTRATION: 'true',
    ...overrides,
  });
  const database = createDatabase(config);
  migrate(database.db, { migrationsFolder });
  const app = await buildApp(config, database);

  return { app, database, config };
}

describe('auth API', () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let database: ReturnType<typeof createDatabase> | undefined;

  afterEach(async () => {
    await app?.close();
    database?.sqlite.close();
    app = undefined;
    database = undefined;
  });

  it('reports a healthy SQLite database', async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    database = testApp.database;

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, dbOk: true });
    expect(response.json().version).toEqual(expect.any(String));
  });

  it('registers a family and logs in', async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    database = testApp.database;

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register-family',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', host: 'localhost:3000' },
      payload: {
        familyName: 'Nowa Rodzina',
        displayName: 'Anna',
        email: 'anna@example.com',
        password: '12345678',
      },
    });

    expect(registerResponse.statusCode).toBe(201);
    expect(registerResponse.json()).toMatchObject({
      ok: true,
      family: { name: 'Nowa Rodzina' },
      user: { displayName: 'Anna', role: 'admin' },
    });
    expect(JSON.stringify(registerResponse.body)).not.toContain('12345678');

    const sessionHeader = getSessionHeader(registerResponse);
    const meResponse = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: sessionHeader },
    });

    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json().user.displayName).toBe('Anna');
  });

  it('rejects invalid login credentials and rate limits repeated attempts', async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    database = testApp.database;

    await app.inject({
      method: 'POST',
      url: '/api/auth/register-family',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', host: 'localhost:3000' },
      payload: {
        familyName: 'Zła Rodzina',
        displayName: 'Tester',
        email: 'tester@example.com',
        password: 'password123',
      },
    });

    for (let i = 0; i < 10; i += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', host: 'localhost:3000', 'x-forwarded-for': '127.0.0.1' },
        payload: { email: 'tester@example.com', password: 'wrong-password' },
      });
      if (i < 9) {
        expect(response.statusCode).toBe(401);
      } else {
        expect(response.statusCode).toBe(429);
        expect(response.json().error.code).toBe('RATE_LIMITED');
      }
    }
  });

  it('requires a valid session for protected routes and rejects expired sessions', async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    database = testApp.database;

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register-family',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', host: 'localhost:3000' },
      payload: {
        familyName: 'Sesyjna Rodzina',
        displayName: 'Marta',
        email: 'marta@example.com',
        password: 'super-secret',
      },
    });

    const cookie = getSessionHeader(registerResponse);

    const unauthenticated = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(unauthenticated.statusCode).toBe(401);

    const authResponse = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(authResponse.statusCode).toBe(200);

    const sessionValue = getSessionHeader(registerResponse).replace(/^sid=/, '');
    const sessionHash = crypto.createHash('sha256').update(sessionValue, 'utf8').digest('hex');
    database!.db.update(schema.sessions).set({ expiresAt: Date.now() - 1000 }).where(eq(schema.sessions.id, sessionHash)).run();

    const expiredResponse = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(expiredResponse.statusCode).toBe(401);
  });

  it('blocks CSRF on mutation requests and disables registrations when configured', async () => {
    const testApp = await createTestApp({ RODZINA_ALLOW_REGISTRATION: 'false' });
    app = testApp.app;
    database = testApp.database;

    const csrfResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register-family',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example', host: 'localhost:3000' },
      payload: {
        familyName: 'Evil',
        displayName: 'Bad',
        email: 'bad@example.com',
        password: 'secret1234',
      },
    });

    expect(csrfResponse.statusCode).toBe(403);
    expect(csrfResponse.json().error.code).toBe('FORBIDDEN');

    const disabledResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register-family',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', host: 'localhost:3000' },
      payload: {
        familyName: 'Evil',
        displayName: 'Bad',
        email: 'bad@example.com',
        password: 'secret1234',
      },
    });

    expect(disabledResponse.statusCode).toBe(403);
    expect(disabledResponse.json().error.code).toBe('FORBIDDEN');
  });
});
