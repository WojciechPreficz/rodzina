import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { hashToken, randomToken } from './auth.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import * as schema from './db/schema.js';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');

function getSessionHeader(response: { headers?: Record<string, string | string[] | number | undefined> }): string {
  const setCookie = response.headers?.['set-cookie'];

  if (Array.isArray(setCookie)) {
    const firstValue = setCookie[0];
    return typeof firstValue === 'string' ? firstValue : '';
  }

  if (typeof setCookie === 'string') {
    return setCookie.split(';')[0] ?? '';
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
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3000',
          host: 'localhost:3000',
          'x-forwarded-for': '127.0.0.1',
        },
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
    database!.db
      .update(schema.sessions)
      .set({ expiresAt: Date.now() - 1000 })
      .where(eq(schema.sessions.id, sessionHash))
      .run();

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

  it('manages family members, permissions, and family settings', async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    database = testApp.database;

    const adminResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register-family',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', host: 'localhost:3000' },
      payload: {
        familyName: 'Rodzina Testowa',
        displayName: 'Anna',
        email: 'anna@example.com',
        password: '12345678',
      },
    });

    expect(adminResponse.statusCode).toBe(201);
    const adminCookie = getSessionHeader(adminResponse);

    const membersResponse = await app.inject({
      method: 'GET',
      url: '/api/members',
      headers: { cookie: adminCookie },
    });
    expect(membersResponse.statusCode).toBe(200);
    expect(membersResponse.json().members).toHaveLength(1);

    const childResponse = await app.inject({
      method: 'POST',
      url: '/api/members/child',
      headers: {
        'content-type': 'application/json',
        cookie: adminCookie,
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
      },
      payload: {
        displayName: 'Kasia',
        pin: '1234',
        color: '#FF5733',
      },
    });

    expect(childResponse.statusCode).toBe(201);
    const childMember = childResponse.json().member;
    expect(childMember.role).toBe('child');

    const childSessionValue = randomToken();
    database!.db
      .insert(schema.sessions)
      .values({
        id: hashToken(childSessionValue),
        userId: childMember.id,
        expiresAt: Date.now() + 1000 * 60 * 60,
        createdAt: Date.now(),
        userAgent: 'vitest',
      })
      .run();

    const childPatchResponse = await app.inject({
      method: 'PATCH',
      url: `/api/members/${childMember.id}`,
      headers: {
        'content-type': 'application/json',
        cookie: `sid=${childSessionValue}`,
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
      },
      payload: {
        displayName: 'Kasia Nowa',
        color: '#00FF00',
        role: 'member',
      },
    });

    expect(childPatchResponse.statusCode).toBe(403);

    const childAllowedPatchResponse = await app.inject({
      method: 'PATCH',
      url: `/api/members/${childMember.id}`,
      headers: {
        'content-type': 'application/json',
        cookie: `sid=${childSessionValue}`,
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
      },
      payload: {
        displayName: 'Kasia Nowa',
        color: '#00FF00',
      },
    });

    expect(childAllowedPatchResponse.statusCode).toBe(200);
    expect(childAllowedPatchResponse.json().member.displayName).toBe('Kasia Nowa');

    const familyPatchResponse = await app.inject({
      method: 'PATCH',
      url: '/api/family',
      headers: {
        'content-type': 'application/json',
        cookie: adminCookie,
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
      },
      payload: { name: 'Nowa Nazwa Rodziny' },
    });

    expect(familyPatchResponse.statusCode).toBe(200);
    expect(familyPatchResponse.json().family.name).toBe('Nowa Nazwa Rodziny');

    const rotateResponse = await app.inject({
      method: 'POST',
      url: '/api/family/join-code/rotate',
      headers: { cookie: adminCookie, origin: 'http://localhost:3000', host: 'localhost:3000' },
    });

    expect(rotateResponse.statusCode).toBe(200);
    expect(rotateResponse.json().joinCode).toHaveLength(6);

    const lastAdminDeleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/members/${adminResponse.json().user.id}`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3000', host: 'localhost:3000' },
    });

    expect(lastAdminDeleteResponse.statusCode).toBe(400);

    const secondFamilyResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register-family',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', host: 'localhost:3000' },
      payload: {
        familyName: 'Druga Rodzina',
        displayName: 'Marek',
        email: 'marek@example.com',
        password: '12345678',
      },
    });

    const secondFamilyId = secondFamilyResponse.json().user.id;
    const crossFamilyPatchResponse = await app.inject({
      method: 'PATCH',
      url: `/api/members/${secondFamilyId}`,
      headers: {
        'content-type': 'application/json',
        cookie: adminCookie,
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
      },
      payload: { displayName: 'Marek Zmodyfikowany' },
    });

    expect(crossFamilyPatchResponse.statusCode).toBe(404);
  });

  it('supports invitations, child login, and password resets', async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    database = testApp.database;

    const adminResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register-family',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', host: 'localhost:3000' },
      payload: {
        familyName: 'Rodzina Zaproszeń',
        displayName: 'Admin',
        email: 'admin@example.com',
        password: 'zahaszowane1',
      },
    });

    expect(adminResponse.statusCode).toBe(201);
    const adminCookie = getSessionHeader(adminResponse);
    const joinCode = adminResponse.json().family.joinCode;

    const invitationResponse = await app.inject({
      method: 'POST',
      url: '/api/invitations',
      headers: {
        'content-type': 'application/json',
        cookie: adminCookie,
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
      },
      payload: { role: 'member' },
    });

    expect(invitationResponse.statusCode).toBe(200);
    const token = invitationResponse.json().token;

    const invitationPreview = await app.inject({ method: 'GET', url: `/api/invitations/${token}` });
    expect(invitationPreview.statusCode).toBe(200);
    expect(invitationPreview.json().family.name).toBe('Rodzina Zaproszeń');

    const acceptResponse = await app.inject({
      method: 'POST',
      url: `/api/invitations/${token}/accept`,
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', host: 'localhost:3000' },
      payload: {
        displayName: 'Kamil',
        email: 'kamil@example.com',
        password: 'noweHaslo123',
      },
    });

    expect(acceptResponse.statusCode).toBe(201);
    const invitedUserId = acceptResponse.json().user.id;

    const childResponse = await app.inject({
      method: 'POST',
      url: '/api/members/child',
      headers: {
        'content-type': 'application/json',
        cookie: adminCookie,
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
      },
      payload: { displayName: 'Ola', pin: '4321', color: '#FFB703' },
    });

    expect(childResponse.statusCode).toBe(201);
    const childMemberId = childResponse.json().member.id;

    const familyMembersResponse = await app.inject({
      method: 'GET',
      url: `/api/auth/family-members?joinCode=${joinCode}`,
    });
    expect(familyMembersResponse.statusCode).toBe(200);
    expect(familyMembersResponse.json().members).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: childMemberId, displayName: 'Ola' })]),
    );

    const childLoginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login-child',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', host: 'localhost:3000' },
      payload: { joinCode, userId: childMemberId, pin: '4321' },
    });

    expect(childLoginResponse.statusCode).toBe(200);
    expect(childLoginResponse.json().user.displayName).toBe('Ola');

    const resetLinkResponse = await app.inject({
      method: 'POST',
      url: `/api/members/${invitedUserId}/password-reset-link`,
      headers: { cookie: adminCookie, origin: 'http://localhost:3000', host: 'localhost:3000' },
    });

    expect(resetLinkResponse.statusCode).toBe(200);
    const resetToken = resetLinkResponse.json().token;

    const resetPasswordResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', host: 'localhost:3000' },
      payload: { token: resetToken, password: 'noweHaslo456' },
    });

    expect(resetPasswordResponse.statusCode).toBe(200);

    const loginWithNewPasswordResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', host: 'localhost:3000' },
      payload: { email: 'kamil@example.com', password: 'noweHaslo456' },
    });

    expect(loginWithNewPasswordResponse.statusCode).toBe(200);
  });
});
