// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFixtureApp as buildApp } from '../../test-fixtures.js';
import * as auth from '../../auth.js';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../db/client.js';
import { authRateLimits, families } from '../../db/schema.js';
import {
  CHILD_PIN_LIMIT,
  CHILD_PIN_WINDOW_MS,
  FAMILY_LOOKUP_FAILURE_LIMIT,
  FAMILY_LOOKUP_IP_LIMIT,
  LOGIN_RATE_WINDOW_MS,
} from './rate-limit-service.js';

describe('persistent login limits', { timeout: 20000 }, () => {
  let directory: string;
  let config: ReturnType<typeof loadConfig>;
  let database: ReturnType<typeof createDatabase>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let childCredentials: { joinCode: string; userId: string; pin: string };
  let adminCookie: string;
  const passwordCredentials = { email: 'admin@example.com', password: 'password123' };
  const headers = { host: 'localhost:3000', origin: 'http://localhost:3000' };
  const post = (url: string, payload: object, ip = '192.0.2.1') =>
    app.inject({ method: 'POST', url, payload, headers, remoteAddress: ip });
  const credentials = (kind: 'password' | 'child', valid = false) =>
    kind === 'password'
      ? { ...passwordCredentials, password: valid ? passwordCredentials.password : 'incorrect123' }
      : { ...childCredentials, pin: valid ? childCredentials.pin : '9999' };
  const url = (kind: 'password' | 'child') => `/api/auth/${kind === 'password' ? 'login' : 'login-child'}`;
  const lookup = (joinCode: string, ip = '192.0.2.1') =>
    app.inject({ method: 'GET', url: '/api/auth/family-members', query: { joinCode }, remoteAddress: ip });
  const counts = () =>
    database.db
      .select()
      .from(authRateLimits)
      .all()
      .map((row) => row.count);

  async function reopenApp() {
    await app.close();
    database.sqlite.close();
    database = createDatabase(config);
    app = await buildApp(config, database);
  }

  beforeEach(async () => {
    directory = mkdtempSync(path.join(tmpdir(), 'rodzina-auth-limits-'));
    config = loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: path.join(directory, 'auth.db') });
    database = createDatabase(config);
    migrate(database.db, { migrationsFolder: './apps/api/drizzle' });
    app = await buildApp(config, database);
    const registration = await post('/api/test/families', {
      ...passwordCredentials,
      familyName: 'Family',
      displayName: 'Admin',
    });
    expect(registration.statusCode).toBe(201);
    adminCookie = String(registration.headers['set-cookie']).split(';')[0]!;
    const child = await app.inject({
      method: 'POST',
      url: '/api/members/child',
      payload: { displayName: 'Child', pin: '1234' },
      headers: { ...headers, cookie: adminCookie },
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
    for (let i = 0; i < 10; i++) expect((await post(url(kind), credentials(kind))).statusCode).toBe(403);
    await reopenApp();
    const response = await post(url(kind), credentials(kind, true));
    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Za dużo prób logowania. Spróbuj ponownie później.' },
    });
    expect(counts()).toEqual(kind === 'child' ? [10, 10] : [10]);
  });

  it.each(['password', 'child'] as const)('clears the %s IP counter after a successful login', async (kind) => {
    for (let i = 0; i < 9; i++) expect((await post(url(kind), credentials(kind))).statusCode).toBe(403);
    const success = await post(url(kind), credentials(kind, true));
    expect(success.statusCode).toBe(200);
    expect(success.headers['set-cookie']).toBeDefined();
    expect(counts()).toEqual(kind === 'child' ? [9] : []);
    expect((await post(url(kind), credentials(kind))).statusCode).toBe(403);
    expect(counts().sort((a, b) => a - b)).toEqual(kind === 'child' ? [1, 10] : [1]);
  });

  it.each(['password', 'child'] as const)('expires the %s limit at the exact boundary without cron', async (kind) => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    for (let i = 0; i < 10; i++) expect((await post(url(kind), credentials(kind))).statusCode).toBe(403);
    clock.mockReturnValue(now + LOGIN_RATE_WINDOW_MS - 1);
    expect((await post(url(kind), credentials(kind))).statusCode).toBe(429);
    clock.mockReturnValue(now + LOGIN_RATE_WINDOW_MS);
    expect((await post(url(kind), credentials(kind))).statusCode).toBe(403);
    expect(database.db.select().from(authRateLimits).all()).toContainEqual(
      expect.objectContaining({
        count: 1,
        expiresAt: now + 2 * LOGIN_RATE_WINDOW_MS,
      }),
    );
    expect((await post(url(kind), credentials(kind, true))).statusCode).toBe(200);
  });

  it('normalizes emails and separates IPs, accounts and child scopes without storing raw identities', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await post(url('password'), { email: ' ADMIN@EXAMPLE.COM ', password: 'incorrect123' })).statusCode).toBe(
        403,
      );
    }
    expect((await post(url('password'), credentials('password', true))).statusCode).toBe(429);
    expect((await post(url('password'), credentials('password'), '192.0.2.2')).statusCode).toBe(403);
    expect((await post(url('password'), { email: 'other@example.com', password: 'incorrect123' })).statusCode).toBe(
      403,
    );
    expect((await post(url('child'), credentials('child'))).statusCode).toBe(403);
    const keys = database.db
      .select()
      .from(authRateLimits)
      .all()
      .map((row) => row.scopeKey);
    expect(keys).toHaveLength(5);
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
      expect(responses.filter((response) => response.statusCode === 403)).toHaveLength(10);
      expect(responses.filter((response) => response.statusCode === 429)).toHaveLength(10);
      expect(database.db.select().from(authRateLimits).get()?.count).toBe(10);
      expect(secondDatabase.db.select().from(authRateLimits).get()?.count).toBe(10);
    } finally {
      await secondApp.close();
      secondDatabase.sqlite.close();
    }
  });

  it('ignores untrusted forwarding so changing a client-supplied IP cannot bypass the limit', async () => {
    const request = (forwarded: string) =>
      app.inject({
        method: 'POST',
        url: url('password'),
        payload: credentials('password'),
        remoteAddress: '127.0.0.1',
        headers: { ...headers, 'x-forwarded-for': forwarded },
      });
    for (let i = 0; i < 10; i++) expect((await request('192.0.2.1, 192.0.2.100')).statusCode).toBe(403);
    expect((await request('192.0.2.1, 192.0.2.100')).statusCode).toBe(429);
    expect((await request('192.0.2.2, 192.0.2.100')).statusCode).toBe(429);
  });

  it.each(['password', 'child'] as const)(
    'reserves a %s attempt before verification and skips hashing when blocked',
    async (kind) => {
      const verify = vi
        .spyOn(auth, kind === 'password' ? 'verifyPassword' : 'verifyPin')
        .mockImplementation(async () => {
          expect(database.sqlite.inTransaction).toBe(false);
          expect(counts()).toEqual(Array(kind === 'child' ? 2 : 1).fill(verify.mock.calls.length));
          return false;
        });
      for (let i = 0; i < 10; i++) expect((await post(url(kind), credentials(kind))).statusCode).toBe(403);
      expect((await post(url(kind), credentials(kind))).statusCode).toBe(429);
      expect(verify).toHaveBeenCalledTimes(10);
    },
  );

  it('limits successful profile lookups per IP and keeps the limit after restart', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    for (let i = 0; i < FAMILY_LOOKUP_IP_LIMIT; i++) {
      const response = await lookup(childCredentials.joinCode);
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json().members).toEqual(response.json().children);
    }
    await reopenApp();
    const blocked = await lookup(childCredentials.joinCode);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBe('900');
    expect((await lookup(childCredentials.joinCode, '192.0.2.2')).statusCode).toBe(200);
    clock.mockReturnValue(now + LOGIN_RATE_WINDOW_MS);
    expect((await lookup(childCredentials.joinCode)).statusCode).toBe(200);
  });

  it('combines misses across IPs, including families without children', async () => {
    const emptyCode = 'EMPTY2';
    database.db
      .insert(families)
      .values({ id: 'empty', name: 'Empty', joinCode: emptyCode, createdAt: Date.now() })
      .run();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const missing = 'MSSNG2';
    const response = await lookup(missing);
    expect(response.statusCode).toBe(404);
    expect((await lookup(emptyCode)).json()).toEqual(response.json());
    for (let i = 2; i < FAMILY_LOOKUP_FAILURE_LIMIT - 1; i++) {
      expect((await lookup(i % 2 ? missing : emptyCode, `198.51.100.${i}`)).statusCode).toBe(404);
    }
    expect((await lookup(childCredentials.joinCode)).statusCode).toBe(200);
    expect((await lookup(emptyCode)).statusCode).toBe(404);
    await reopenApp();
    for (const code of [missing, emptyCode, childCredentials.joinCode]) {
      const blocked = await lookup(code, '203.0.113.1');
      expect(blocked.statusCode).toBe(429);
      expect(blocked.headers['retry-after']).toBe('900');
    }
    clock.mockReturnValue(now + LOGIN_RATE_WINDOW_MS);
    expect((await lookup(childCredentials.joinCode, '203.0.113.1')).statusCode).toBe(200);
  });

  it('shares the PIN budget across concurrent clients, restarts and code rotation until an admin changes the PIN', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const verify = vi.spyOn(auth, 'verifyPin').mockResolvedValue(false);
    const responses = await Promise.all(
      Array.from({ length: CHILD_PIN_LIMIT + 4 }, (_, index) =>
        post(url('child'), credentials('child'), `198.51.100.${index < 10 ? 1 : index + 1}`),
      ),
    );
    expect(responses.filter((response) => response.statusCode === 403)).toHaveLength(CHILD_PIN_LIMIT);
    expect(responses.filter((response) => response.statusCode === 429)).toHaveLength(4);
    expect(verify).toHaveBeenCalledTimes(CHILD_PIN_LIMIT);
    verify.mockRestore();
    await reopenApp();
    const blocked = await post(url('child'), credentials('child', true));
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBe(String(CHILD_PIN_WINDOW_MS / 1000));
    expect(blocked.json().error.message).toContain('administratora');

    const adminHeaders = { ...headers, cookie: adminCookie };
    const rotation = await app.inject({ method: 'POST', url: '/api/family/join-code/rotate', headers: adminHeaders });
    expect(rotation.statusCode).toBe(200);
    childCredentials.joinCode = rotation.json().joinCode;
    expect((await post(url('child'), credentials('child', true))).statusCode).toBe(429);
    const sibling = await app.inject({
      method: 'POST',
      url: '/api/members/child',
      headers: adminHeaders,
      payload: { displayName: 'Sibling', pin: '1234' },
    });
    expect(sibling.statusCode).toBe(201);
    expect((await post(url('child'), { ...childCredentials, userId: sibling.json().member.id })).statusCode).toBe(200);

    const update = await app.inject({
      method: 'PATCH',
      url: `/api/members/${childCredentials.userId}`,
      headers: adminHeaders,
      payload: { pin: '4321' },
    });
    expect(update.statusCode).toBe(200);
    expect((await post(url('child'), { ...childCredentials, pin: '4321' }, '198.51.100.1')).statusCode).toBe(200);
  });

  it('expires the shared PIN limit at the end of its window', async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const verify = vi.spyOn(auth, 'verifyPin').mockResolvedValue(false);
    for (let i = 0; i < CHILD_PIN_LIMIT; i++)
      expect((await post(url('child'), credentials('child'), `198.51.100.${i + 1}`)).statusCode).toBe(403);
    verify.mockRestore();
    clock.mockReturnValue(now + CHILD_PIN_WINDOW_MS - 1);
    const blocked = await post(url('child'), childCredentials);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBe('1');
    clock.mockReturnValue(now + CHILD_PIN_WINDOW_MS);
    expect((await post(url('child'), childCredentials)).statusCode).toBe(200);
  });

  it('rejects a verified old PIN when the admin changes it during verification', async () => {
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let finishVerification!: (value: boolean) => void;
    const verified = new Promise<boolean>((resolve) => {
      finishVerification = resolve;
    });
    vi.spyOn(auth, 'verifyPin').mockImplementationOnce(() => {
      signalStarted();
      return verified;
    });
    const login = post(url('child'), childCredentials);
    await started;
    try {
      const update = await app.inject({
        method: 'PATCH',
        url: `/api/members/${childCredentials.userId}`,
        headers: { ...headers, cookie: adminCookie },
        payload: { pin: '4321' },
      });
      expect(update.statusCode).toBe(200);
    } finally {
      finishVerification(true);
    }
    const response = await login;
    expect(response.statusCode).toBe(403);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect((await post(url('child'), { ...childCredentials, pin: '4321' })).statusCode).toBe(200);
  });

  it('keeps legacy codes usable and gives unknown codes and profiles the same login error', async () => {
    database.db
      .update(families)
      .set({ joinCode: 'LEGACY' })
      .where(eq(families.joinCode, childCredentials.joinCode))
      .run();
    childCredentials.joinCode = 'LEGACY';
    expect((await lookup(childCredentials.joinCode)).statusCode).toBe(200);
    expect((await post(url('child'), childCredentials)).statusCode).toBe(200);
    const invalidCode = await post(url('child'), { ...childCredentials, joinCode: 'MSSNG2' });
    const invalidChild = await post(url('child'), { ...childCredentials, userId: 'missing' });
    expect(invalidCode.statusCode).toBe(403);
    expect(invalidChild.statusCode).toBe(invalidCode.statusCode);
    expect(invalidChild.json()).toEqual(invalidCode.json());
  });
});
