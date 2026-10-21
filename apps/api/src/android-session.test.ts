// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { hashToken, SESSION_REFRESH_INTERVAL_MS, SESSION_TTL_MS } from './auth.js';
import { sessions } from './db/schema.js';
import { buildApp } from './app.js';
import { createDatabase } from './db/client.js';
import { loadConfig } from './config.js';

describe('native cookie transport with unchanged browser security', () => {
  let database: ReturnType<typeof createDatabase>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const headers = { host: 'rodzina.preficze.pl', origin: 'https://rodzina.preficze.pl' };
  const credentials = {
    familyName: 'Rodzina',
    displayName: 'Admin',
    email: 'android@example.com',
    password: 'password123',
  };
  const event = { kind: 'single', title: 'Basen', startDate: '2026-10-20', startTime: '17:00', durationMinutes: 60 };
  const cookieOf = (response: { headers: Record<string, unknown> }) =>
    String(response.headers['set-cookie']).split(';')[0]!;
  beforeEach(async () => {
    database = createDatabase(loadConfig({ RODZINA_DATABASE_PATH: ':memory:' }));
    migrate(database.db, { migrationsFolder: './apps/api/drizzle' });
    app = await buildApp(loadConfig({ RODZINA_ALLOW_REGISTRATION: 'true' }), database);
  });
  afterEach(async () => {
    await app.close();
    database.sqlite.close();
  });

  it('supports adult and child sessions, renewal, calendar CRUD and logout using native cookie headers', async () => {
    const registration = await app.inject({
      method: 'POST',
      url: '/api/auth/register-family',
      headers,
      payload: credentials,
    });
    expect(registration.statusCode).toBe(201);
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', headers, payload: credentials });
    expect(login.statusCode).toBe(200);
    const cookie = cookieOf(login);
    const child = await app.inject({
      method: 'POST',
      url: '/api/members/child',
      headers: { ...headers, cookie },
      payload: { displayName: 'Zosia', pin: '1234', color: '#123456' },
    });
    expect(child.statusCode).toBe(201);
    const childLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login-child',
      headers,
      payload: { joinCode: registration.json().family.joinCode, userId: child.json().member.id, pin: '1234' },
    });
    expect(childLogin.statusCode).toBe(200);
    for (const session of [cookie, cookieOf(childLogin)]) {
      const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { ...headers, cookie: session } });
      expect(me.statusCode).toBe(200);
      expect(me.headers['set-cookie']).toBeUndefined();
      database.db
        .update(sessions)
        .set({ expiresAt: Date.now() + SESSION_TTL_MS - SESSION_REFRESH_INTERVAL_MS - 1000 })
        .where(eq(sessions.id, hashToken(session.slice(4))))
        .run();
      const renewed = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { ...headers, cookie: session },
      });
      expect(renewed.statusCode).toBe(200);
      expect(renewed.headers['set-cookie']).toContain('Max-Age=5184000');
      expect(cookieOf(renewed)).toBe(session);
      const saved = await app.inject({
        method: 'POST',
        url: '/api/events',
        headers: { ...headers, cookie: session },
        payload: event,
      });
      expect(saved.statusCode).toBe(201);
      const id = saved.json().event.id;
      expect(
        (await app.inject({ method: 'GET', url: `/api/events/${id}`, headers: { cookie: session } })).statusCode,
      ).toBe(200);
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: `/api/events/${id}`,
            headers: { ...headers, cookie: session },
            payload: { title: 'Nowy tytuł' },
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { ...headers, cookie: session } }))
          .statusCode,
      ).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: session } })).statusCode).toBe(
        401,
      );
    }
  });

  it('rejects WebView and foreign origins, missing sessions and another family', async () => {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register-family',
      headers,
      payload: credentials,
    });
    const cookie = cookieOf(registered);
    for (const origin of ['https://localhost', 'https://evil.example']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/events',
        headers: { host: headers.host, cookie, ...(origin ? { origin } : {}) },
        payload: event,
      });
      expect(response.statusCode).toBe(403);
    }
    expect((await app.inject({ method: 'POST', url: '/api/events', headers, payload: event })).statusCode).toBe(401);
    const saved = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { ...headers, cookie },
      payload: event,
    });
    const other = await app.inject({
      method: 'POST',
      url: '/api/auth/register-family',
      headers,
      payload: { ...credentials, email: 'other@example.com' },
    });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/events/${saved.json().event.id}`,
          headers: { cookie: cookieOf(other) },
        })
      ).statusCode,
    ).toBe(404);
  });
});
