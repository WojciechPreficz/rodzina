// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import * as auth from '../../auth.js';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../db/client.js';
import { authRateLimits } from '../../db/schema.js';
import { LOGIN_RATE_WINDOW_MS } from './rate-limit-service.js';

describe('persistent login limits', { timeout: 20000 }, () => {
  let directory: string;
  let config: ReturnType<typeof loadConfig>;
  let database: ReturnType<typeof createDatabase>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let childCredentials: { joinCode: string; userId: string; pin: string };
  const passwordCredentials = { email: 'admin@example.com', password: 'password123' };
  const headers = { host: 'localhost:3000', origin: 'http://localhost:3000' };
  const post = (url: string, payload: object, ip = '192.0.2.1') =>
    app.inject({ method: 'POST', url, payload, headers, remoteAddress: ip });
  const credentials = (kind: 'password' | 'child', valid = false) =>
    kind === 'password'
      ? { ...passwordCredentials, password: valid ? passwordCredentials.password : 'incorrect123' }
      : { ...childCredentials, pin: valid ? childCredentials.pin : '9999' };
  const url = (kind: 'password' | 'child') => `/api/auth/${kind === 'password' ? 'login' : 'login-child'}`;

  beforeEach(async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'rodzina-auth-limits-'));
    config = loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: path.join(directory, 'auth.db') });
    database = createDatabase(config);
    migrate(database.db, { migrationsFolder: './apps/api/drizzle' });
    app = await buildApp(config, database);
    const registration = await post('/api/auth/register-family', {
      ...passwordCredentials,
      familyName: 'Family',
      displayName: 'Admin',
    });
    expect(registration.statusCode).toBe(201);
    const child = await app.inject({
      method: 'POST',
      url: '/api/members/child',
      payload: { displayName: 'Child', pin: '1234' },
      headers: { ...headers, cookie: String(registration.headers['set-cookie']).split(';')[0]! },
    });
    expect(child.statusCode).toBe(201);
    childCredentials = { joinCode: registration.json().family.joinCode, userId: child.json().member.id, pin: '1234' };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    database.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it.each(['password', 'child'] as const)('keeps the %s limit after reopening the database', async (kind) => {
    for (let i = 0; i < 10; i++) expect((await post(url(kind), credentials(kind))).statusCode).toBe(401);
    await app.close();
    database.sqlite.close();
    database = createDatabase(config);
    app = await buildApp(config, database);
    const response = await post(url(kind), credentials(kind, true));
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Za dużo prób logowania. Spróbuj ponownie później.' },
    });
    expect(database.db.select().from(authRateLimits).get()?.count).toBe(10);
  });

  it.each(['password', 'child'] as const)('clears the %s counter after a successful login', async (kind) => {
    for (let i = 0; i < 9; i++) expect((await post(url(kind), credentials(kind))).statusCode).toBe(401);
    const success = await post(url(kind), credentials(kind, true));
    expect(success.statusCode).toBe(200);
    expect(success.headers['set-cookie']).toBeDefined();
    expect(database.db.select().from(authRateLimits).all()).toEqual([]);
    expect((await post(url(kind), credentials(kind))).statusCode).toBe(401);
    expect(database.db.select().from(authRateLimits).get()?.count).toBe(1);
  });

  it.each(['password', 'child'] as const)('expires the %s limit at the exact boundary without cron', async (kind) => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    for (let i = 0; i < 10; i++) expect((await post(url(kind), credentials(kind))).statusCode).toBe(401);
    clock.mockReturnValue(now + LOGIN_RATE_WINDOW_MS - 1);
    expect((await post(url(kind), credentials(kind))).statusCode).toBe(429);
    clock.mockReturnValue(now + LOGIN_RATE_WINDOW_MS);
    expect((await post(url(kind), credentials(kind))).statusCode).toBe(401);
    expect(database.db.select().from(authRateLimits).get()).toMatchObject({
      count: 1,
      expiresAt: now + 2 * LOGIN_RATE_WINDOW_MS,
    });
    expect((await post(url(kind), credentials(kind, true))).statusCode).toBe(200);
  });

  it('normalizes emails and separates IPs, accounts and child scopes without storing raw identities', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await post(url('password'), { email: ' ADMIN@EXAMPLE.COM ', password: 'incorrect123' })).statusCode).toBe(
        401,
      );
    }
    expect((await post(url('password'), credentials('password', true))).statusCode).toBe(429);
    expect((await post(url('password'), credentials('password'), '192.0.2.2')).statusCode).toBe(401);
    expect((await post(url('password'), { email: 'other@example.com', password: 'incorrect123' })).statusCode).toBe(
      401,
    );
    expect((await post(url('child'), credentials('child'))).statusCode).toBe(401);
    const keys = database.db
      .select()
      .from(authRateLimits)
      .all()
      .map((row) => row.scopeKey);
    expect(keys).toHaveLength(4);
    expect(keys.every((key) => /^[a-f0-9]{64}$/.test(key))).toBe(true);
  });

  it('reserves only ten concurrent requests across two application connections', async () => {
    const secondDatabase = createDatabase(config);
    const secondApp = await buildApp(config, secondDatabase);
    try {
      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          (index % 2 ? app : secondApp).inject({
            method: 'POST',
            url: url('password'),
            payload: credentials('password'),
            headers,
            remoteAddress: '192.0.2.1',
          }),
        ),
      );
      expect(responses.filter((response) => response.statusCode === 401)).toHaveLength(10);
      expect(responses.filter((response) => response.statusCode === 429)).toHaveLength(10);
      expect(database.db.select().from(authRateLimits).get()?.count).toBe(10);
      expect(secondDatabase.db.select().from(authRateLimits).get()?.count).toBe(10);
    } finally {
      await secondApp.close();
      secondDatabase.sqlite.close();
    }
  });

  it('uses the forwarded client IP under the existing trustProxy policy', async () => {
    const request = (forwarded: string) =>
      app.inject({
        method: 'POST',
        url: url('password'),
        payload: credentials('password'),
        remoteAddress: '127.0.0.1',
        headers: { ...headers, 'x-forwarded-for': forwarded },
      });
    for (let i = 0; i < 10; i++) expect((await request('192.0.2.1, 192.0.2.100')).statusCode).toBe(401);
    expect((await request('192.0.2.1, 192.0.2.100')).statusCode).toBe(429);
    expect((await request('192.0.2.2, 192.0.2.100')).statusCode).toBe(401);
  });

  it.each(['password', 'child'] as const)(
    'reserves a %s attempt before verification and skips hashing when blocked',
    async (kind) => {
      const verify = vi
        .spyOn(auth, kind === 'password' ? 'verifyPassword' : 'verifyPin')
        .mockImplementation(async () => {
          expect(database.sqlite.inTransaction).toBe(false);
          expect(database.db.select().from(authRateLimits).get()?.count).toBe(verify.mock.calls.length);
          return false;
        });
      for (let i = 0; i < 10; i++) expect((await post(url(kind), credentials(kind))).statusCode).toBe(401);
      expect((await post(url(kind), credentials(kind))).statusCode).toBe(429);
      expect(verify).toHaveBeenCalledTimes(10);
    },
  );
});
