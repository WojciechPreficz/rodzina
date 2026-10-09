import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { buildApp } from './app.js';
import { createDatabase } from './db/client.js';
import { loadConfig } from './config.js';
import { hashToken, SESSION_TTL_MS } from './auth.js';
import * as schema from './db/schema.js';

describe('authentication regressions', () => {
  let database: ReturnType<typeof createDatabase>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let admin: { user: { id: string }; family: { joinCode: string } };
  let cookie: string;
  const headers = { origin: 'http://localhost:3000', host: 'localhost:3000' };
  const registerBody = {
    familyName: 'Test Family',
    displayName: 'Admin',
    email: 'regression@example.com',
    password: 'password123',
  };
  const post = (url: string, payload?: object, session?: string) =>
    app.inject({
      method: 'POST',
      url,
      headers: { ...headers, ...(session ? { cookie: session } : {}) },
      ...(payload ? { payload } : {}),
    });

  beforeEach(async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      RODZINA_DATABASE_PATH: ':memory:',
      RODZINA_PUBLIC_URL: 'http://localhost:3000',
      RODZINA_ALLOW_REGISTRATION: 'true',
    });
    database = createDatabase(config);
    migrate(database.db, { migrationsFolder: './apps/api/drizzle' });
    app = await buildApp(config, database);
    const response = await post('/api/auth/register-family', registerBody);
    expect(response.statusCode).toBe(201);
    admin = response.json();
    cookie = String(response.headers['set-cookie']).split(';')[0]!;
  });

  afterEach(async () => {
    await app.close();
    database.sqlite.close();
  });

  it('blocks the eleventh incorrect PIN and invalidates the old family code', async () => {
    const child = await post('/api/members/child', { displayName: 'Child', pin: '1234' }, cookie);
    const credentials = { joinCode: admin.family.joinCode, userId: child.json().member.id, pin: '9999' };
    for (let i = 0; i < 10; i++) expect((await post('/api/auth/login-child', credentials)).statusCode).toBe(401);
    expect((await post('/api/auth/login-child', credentials)).statusCode).toBe(429);
    expect((await post('/api/auth/login-child', { ...credentials, pin: '1234' })).statusCode).toBe(429);
    const rotation = await post('/api/family/join-code/rotate', undefined, cookie);
    expect(rotation.statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: `/api/auth/family-members?joinCode=${credentials.joinCode}` }))
        .statusCode,
    ).toBe(404);
  });

  it('renews both the database expiration and the browser cookie on activity', async () => {
    const sessionId = hashToken(cookie.slice(4));
    database.db
      .update(schema.sessions)
      .set({ expiresAt: Date.now() + 1000 })
      .where(eq(schema.sessions.id, sessionId))
      .run();
    const response = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toContain(cookie);
    expect(response.headers['set-cookie']).toContain(`Max-Age=${SESSION_TTL_MS / 1000}`);
    expect(
      database.db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get()!.expiresAt,
    ).toBeGreaterThan(Date.now() + SESSION_TTL_MS - 10000);
  });

  it('consumes an invitation once even when two accounts accept concurrently', async () => {
    const invitation = await post('/api/invitations', { role: 'member' }, cookie);
    const url = `/api/invitations/${invitation.json().token}/accept`;
    const responses = await Promise.all(
      [0, 1].map((i) =>
        post(url, { displayName: `Person ${i}`, email: `person${i}@example.com`, password: 'password123' }),
      ),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 410]);
    expect(database.db.select().from(schema.users).all()).toHaveLength(2);
    expect((await app.inject({ method: 'GET', url: `/api/invitations/${invitation.json().token}` })).statusCode).toBe(
      410,
    );
  });

  it('consumes a reset once under concurrent requests and rejects expired tokens', async () => {
    const link = await post(`/api/members/${admin.user.id}/password-reset-link`, undefined, cookie);
    const responses = await Promise.all(
      ['newPassword1', 'newPassword2'].map((password) =>
        post('/api/auth/reset-password', { token: link.json().token, password }),
      ),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 410]);
    const winner = responses.findIndex((r) => r.statusCode === 200);
    expect(
      (await post('/api/auth/login', { email: registerBody.email, password: ['newPassword1', 'newPassword2'][winner] }))
        .statusCode,
    ).toBe(200);
    const expired = await post(`/api/members/${admin.user.id}/password-reset-link`, undefined, cookie);
    database.db
      .update(schema.passwordResets)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(schema.passwordResets.tokenHash, hashToken(expired.json().token)))
      .run();
    expect(
      (await post('/api/auth/reset-password', { token: expired.json().token, password: 'password456' })).statusCode,
    ).toBe(410);
  });

  it('rolls back a family when the email is registered concurrently', async () => {
    const responses = await Promise.all(
      [0, 1].map((i) =>
        post('/api/auth/register-family', {
          ...registerBody,
          familyName: `Family ${i}`,
          email: 'duplicate@example.com',
        }),
      ),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    expect(database.db.select().from(schema.families).all()).toHaveLength(2);
    expect(database.db.select().from(schema.users).all()).toHaveLength(2);
  });

  it('rejects changing between child and adult account types', async () => {
    const child = await post('/api/members/child', { displayName: 'Child', pin: '1234' }, cookie);
    for (const [id, role] of [
      [child.json().member.id, 'member'],
      [admin.user.id, 'child'],
    ]) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/members/${id}`,
        headers: { ...headers, cookie },
        payload: { role },
      });
      expect(response.statusCode).toBe(400);
    }
    expect(
      (
        await post('/api/auth/login-child', {
          joinCode: admin.family.joinCode,
          userId: child.json().member.id,
          pin: '1234',
        })
      ).statusCode,
    ).toBe(200);
  });

  it('rejects expired invitations and exposes only child profile fields', async () => {
    const child = await post('/api/members/child', { displayName: 'Child', pin: '1234' }, cookie);
    const profiles = await app.inject({
      method: 'GET',
      url: `/api/auth/family-members?joinCode=${admin.family.joinCode}`,
    });
    expect(profiles.json().members).toEqual([{ id: child.json().member.id, displayName: 'Child', color: '#7BC6B9' }]);
    const invitation = await post('/api/invitations', { role: 'member' }, cookie);
    database.db
      .update(schema.invitations)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(schema.invitations.id, invitation.json().invitation.id))
      .run();
    expect(
      (
        await post(`/api/invitations/${invitation.json().token}/accept`, {
          displayName: 'Person',
          email: 'person@example.com',
          password: 'password123',
        })
      ).statusCode,
    ).toBe(410);
  });

  it('enforces adult and child permissions, family isolation and removal of sessions', async () => {
    const invitation = await post('/api/invitations', { role: 'member' }, cookie);
    const adult = await post(`/api/invitations/${invitation.json().token}/accept`, {
      displayName: 'Adult',
      email: 'matrix@example.com',
      password: 'password123',
    });
    const adultCookie = String(adult.headers['set-cookie']).split(';')[0]!;
    const child = await post('/api/members/child', { displayName: 'Child', pin: '1234' }, cookie);
    const login = await post('/api/auth/login-child', {
      joinCode: admin.family.joinCode,
      userId: child.json().member.id,
      pin: '1234',
    });
    const childCookie = String(login.headers['set-cookie']).split(';')[0]!;
    for (const session of [adultCookie, childCookie]) {
      for (const [url, payload] of [
        ['/api/members/child', { displayName: 'Blocked', pin: '1234' }],
        ['/api/invitations', { role: 'admin' }],
        ['/api/family/join-code/rotate', {}],
        [`/api/members/${admin.user.id}/password-reset-link`, {}],
      ] as const)
        expect((await post(url, payload, session)).statusCode).toBe(403);
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: '/api/family',
            headers: { ...headers, cookie: session },
            payload: { name: 'Blocked' },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/api/members/${admin.user.id}`,
            headers: { ...headers, cookie: session },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: `/api/members/${admin.user.id}`,
            headers: { ...headers, cookie: session },
            payload: { displayName: 'Blocked' },
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/members/${admin.user.id}`,
          headers: { ...headers, cookie },
          payload: { role: 'member' },
        })
      ).statusCode,
    ).toBe(400);
    const foreign = await post('/api/auth/register-family', { ...registerBody, email: 'foreign@example.com' });
    const foreignId = foreign.json().user.id;
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/members/${foreignId}`, headers: { ...headers, cookie } }))
        .statusCode,
    ).toBe(404);
    expect((await post(`/api/members/${foreignId}/password-reset-link`, undefined, cookie)).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/members/${child.json().member.id}`,
          headers: { ...headers, cookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: childCookie } })).statusCode,
    ).toBe(401);
  });
});
