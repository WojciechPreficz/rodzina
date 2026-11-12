import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { buildFixtureApp as buildApp } from './test-fixtures.js';
import { createDatabase } from './db/client.js';
import { loadConfig } from './config.js';
import { hashToken, SESSION_REFRESH_INTERVAL_MS, SESSION_TTL_MS } from './auth.js';
import * as auth from './auth.js';
import * as schema from './db/schema.js';
import type { sendInvitationMail } from './modules/family/invitation-mail.js';

describe('authentication regressions', () => {
  let database: ReturnType<typeof createDatabase>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let admin: { user: { id: string }; family: { joinCode: string } };
  let cookie: string;
  const headers = { origin: 'http://localhost:3000', host: 'localhost:3000' };
  const sendInvitation = vi.fn<typeof sendInvitationMail>().mockResolvedValue(undefined);
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
  const mailProof = (index: number) =>
    new URLSearchParams(new URL(sendInvitation.mock.calls[index]![1].link).hash.slice(1)).get('token')!;

  beforeEach(async () => {
    sendInvitation.mockReset().mockResolvedValue(undefined);
    const config = loadConfig({
      NODE_ENV: 'test',
      RODZINA_DATABASE_PATH: ':memory:',
      RODZINA_PUBLIC_URL: 'http://localhost:3000',
      RODZINA_ALLOW_REGISTRATION: 'true',
      RODZINA_SMTP_HOST: 'unused.example.com',
      RODZINA_SMTP_USER: 'test',
      RODZINA_SMTP_PASSWORD: 'test-only',
      RODZINA_MAIL_FROM: 'sender@example.com',
    });
    database = createDatabase(config);
    migrate(database.db, { migrationsFolder: './apps/api/drizzle' });
    app = await buildApp(config, database, undefined, undefined, sendInvitation);
    const response = await post('/api/test/families', registerBody);
    expect(response.statusCode).toBe(201);
    admin = response.json();
    cookie = String(response.headers['set-cookie']).split(';')[0]!;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    database.sqlite.close();
  });

  it('distinguishes invalid login credentials from missing sessions', async () => {
    const verify = vi.spyOn(auth, 'verifyPassword');
    const child = await post('/api/members/child', { displayName: 'Child', pin: '1234' }, cookie);
    const attempts = [
      { url: '/api/auth/login', payload: { email: registerBody.email, password: 'incorrect123' } },
      { url: '/api/auth/login', payload: { email: 'missing@example.com', password: 'incorrect123' } },
      {
        url: '/api/auth/login-child',
        payload: { joinCode: admin.family.joinCode, userId: child.json().member.id, pin: '9999' },
      },
      {
        url: '/api/auth/login-child',
        payload: { joinCode: admin.family.joinCode, userId: admin.user.id, pin: '1234' },
      },
    ];
    for (const { url, payload } of attempts) {
      const response = await post(url, payload, cookie);
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('INVALID_CREDENTIALS');
      expect(response.headers['set-cookie']).toBeUndefined();
      expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(200);
    }
    const anonymous = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().error.code).toBe('UNAUTHORIZED');
    expect(verify).toHaveBeenCalledTimes(2);
    expect(verify.mock.calls.map(([hash]) => hash.split('$').slice(1, 4))).toEqual([
      ['argon2id', 'v=19', 'm=65536,t=3,p=1'],
      ['argon2id', 'v=19', 'm=65536,t=3,p=1'],
    ]);
  });

  it('blocks the eleventh incorrect PIN and invalidates the old family code', async () => {
    const child = await post('/api/members/child', { displayName: 'Child', pin: '1234' }, cookie);
    const credentials = { joinCode: admin.family.joinCode, userId: child.json().member.id, pin: '9999' };
    for (let i = 0; i < 10; i++) expect((await post('/api/auth/login-child', credentials)).statusCode).toBe(403);
    expect((await post('/api/auth/login-child', credentials)).statusCode).toBe(429);
    expect((await post('/api/auth/login-child', { ...credentials, pin: '1234' })).statusCode).toBe(429);
    const rotation = await post('/api/family/join-code/rotate', undefined, cookie);
    expect(rotation.statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: `/api/auth/family-members?joinCode=${credentials.joinCode}` }))
        .statusCode,
    ).toBe(404);
  });

  it.each([0, SESSION_REFRESH_INTERVAL_MS - 1, SESSION_REFRESH_INTERVAL_MS, SESSION_REFRESH_INTERVAL_MS + 1])(
    'only renews the expiration and cookie after the daily refresh threshold (%i ms)',
    async (elapsed) => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      const sessionId = hashToken(cookie.slice(4));
      const expiresAt = now + SESSION_TTL_MS - elapsed;
      database.db.update(schema.sessions).set({ expiresAt }).where(eq(schema.sessions.id, sessionId)).run();
      const response = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
      expect(response.statusCode).toBe(200);
      const shouldRefresh = elapsed > SESSION_REFRESH_INTERVAL_MS;
      if (shouldRefresh) {
        expect(response.headers['set-cookie']).toContain(cookie);
        expect(response.headers['set-cookie']).toContain(`Max-Age=${SESSION_TTL_MS / 1000}`);
      } else {
        expect(response.headers['set-cookie']).toBeUndefined();
      }
      expect(database.db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get()!.expiresAt).toBe(
        shouldRefresh ? now + SESSION_TTL_MS : expiresAt,
      );
      const repeated = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
      expect(repeated.statusCode).toBe(200);
      expect(repeated.headers['set-cookie']).toBeUndefined();
    },
  );

  it('does not revive an expired session at its exact expiration time', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const sessionId = hashToken(cookie.slice(4));
    database.db.update(schema.sessions).set({ expiresAt: now }).where(eq(schema.sessions.id, sessionId)).run();
    const response = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(response.statusCode).toBe(401);
    expect(database.db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).get()!.expiresAt).toBe(
      now,
    );
  });

  it('rolls back session deletion when removing a member fails', async () => {
    const child = await post('/api/members/child', { displayName: 'Child', pin: '1234' }, cookie);
    const memberId = child.json().member.id;
    const login = await post('/api/auth/login-child', {
      joinCode: admin.family.joinCode,
      userId: memberId,
      pin: '1234',
    });
    const childCookie = String(login.headers['set-cookie']).split(';')[0]!;
    database.sqlite.exec(
      "CREATE TRIGGER reject_member_deletion BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'test failure'); END",
    );
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/members/${memberId}`,
      payload: { password: registerBody.password },
      headers: { ...headers, cookie },
    });
    expect(response.statusCode).toBe(500);
    expect(database.db.select().from(schema.users).where(eq(schema.users.id, memberId)).get()).toBeDefined();
    expect(
      database.db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, hashToken(childCookie.slice(4))))
        .get(),
    ).toBeDefined();
    expect(
      (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: childCookie } })).statusCode,
    ).toBe(200);
  });

  it('consumes an invitation once even when two accounts accept concurrently', async () => {
    const invitation = await post('/api/invitations', { role: 'member' }, cookie);
    const url = `/api/invitations/${invitation.json().token}`;
    for (const email of ['person0@example.com', 'person1@example.com']) {
      expect((await post(`${url}/email-verification`, { email })).statusCode).toBe(202);
    }
    const responses = await Promise.all(
      [0, 1].map((i) =>
        post(`${url}/accept`, {
          displayName: `Person ${i}`,
          emailVerificationToken: mailProof(i),
          password: 'password123',
        }),
      ),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 410]);
    expect(database.db.select().from(schema.users).all()).toHaveLength(2);
    expect(database.db.select().from(schema.invitationEmailVerifications).all()).toEqual([]);
    expect((await app.inject({ method: 'GET', url: `/api/invitations/${invitation.json().token}` })).statusCode).toBe(
      410,
    );
  });

  it('only discloses an invitation email conflict after proof of that address', async () => {
    const invite = (await post('/api/invitations', { role: 'member' }, cookie)).json();
    const otherInvite = (await post('/api/invitations', { role: 'member' }, cookie)).json();
    const url = `/api/invitations/${invite.token}`;
    const credentials = { displayName: 'Person', password: 'password123' };
    const freeEmail = 'available@example.com';
    for (const [route, status] of [
      ['accept', 409],
      ['email-verification', 202],
    ] as const) {
      const existing = await post(`${url}/${route}`, { ...credentials, email: registerBody.email });
      const available = await post(`${url}/${route}`, { ...credentials, email: freeEmail });
      expect(existing.statusCode).toBe(status);
      expect(available.statusCode).toBe(status);
      expect(existing.body).toBe(available.body);
      expect(existing.headers['set-cookie']).toBeUndefined();
      expect(available.headers['set-cookie']).toBeUndefined();
    }
    expect(database.db.select().from(schema.users).all()).toHaveLength(1);
    expect(sendInvitation.mock.calls.map(([, mail]) => mail.to)).toEqual([
      registerBody.email,
      freeEmail,
      registerBody.email,
      freeEmail,
    ]);
    const accept = (proof: string, extra = {}) =>
      post(`${url}/accept`, {
        ...credentials,
        emailVerificationToken: proof,
        ...extra,
      });
    const wrongInvite = await post(`/api/invitations/${otherInvite.token}/accept`, {
      ...credentials,
      emailVerificationToken: mailProof(3),
    });
    expect(wrongInvite.statusCode).toBe(410);
    expect((await accept('a'.repeat(64))).statusCode).toBe(410);
    expect((await accept(mailProof(2))).json().error.code).toBe('CONFLICT');
    const accepted = await accept(mailProof(3), { email: registerBody.email });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json().user.email).toBe(freeEmail);
    expect((await accept(mailProof(1))).statusCode).toBe(410);
  });

  it('rejects expired or undelivered email proof and limits requests across invitation routes', async () => {
    const invite = (await post('/api/invitations', { role: 'member' }, cookie)).json();
    const url = `/api/invitations/${invite.token}`;
    const email = 'person@example.com';
    const request = () => post(`${url}/email-verification`, { email });
    const credentials = { displayName: 'Person', password: 'password123' };
    const accept = (index: number) =>
      post(`${url}/accept`, { ...credentials, emailVerificationToken: mailProof(index) });
    sendInvitation.mockRejectedValueOnce(new Error('SMTP failure'));
    expect((await request()).statusCode).toBe(202);
    expect((await accept(0)).statusCode).toBe(410);
    expect((await request()).statusCode).toBe(202);
    database.db
      .update(schema.invitationEmailVerifications)
      .set({ expiresAt: Date.now() - 1 })
      .run();
    expect((await accept(1)).statusCode).toBe(410);
    expect((await request()).statusCode).toBe(202);
    const limited = await post(`${url}/accept`, { ...credentials, email: ' PERSON@EXAMPLE.COM ' });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(sendInvitation).toHaveBeenCalledTimes(3);
    expect((await accept(2)).statusCode).toBe(201);
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
    const login = await post('/api/auth/login', {
      email: registerBody.email,
      password: ['newPassword1', 'newPassword2'][winner],
    });
    expect(login.statusCode).toBe(200);
    cookie = String(login.headers['set-cookie']).split(';')[0]!;
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
        post('/api/test/families', {
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
    expect(
      (await post(`/api/invitations/${invitation.json().token}/email-verification`, { email: 'matrix@example.com' }))
        .statusCode,
    ).toBe(202);
    const adult = await post(`/api/invitations/${invitation.json().token}/accept`, {
      displayName: 'Adult',
      emailVerificationToken: mailProof(0),
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
    const foreign = await post('/api/test/families', { ...registerBody, email: 'foreign@example.com' });
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
          payload: { password: registerBody.password },
          headers: { ...headers, cookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: childCookie } })).statusCode,
    ).toBe(401);
  });
});
