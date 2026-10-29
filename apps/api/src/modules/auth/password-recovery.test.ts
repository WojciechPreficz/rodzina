// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../db/client.js';
import { authRateLimits, passwordResets, users } from '../../db/schema.js';
import { hashToken } from '../../auth.js';
import * as auth from '../../auth.js';
import { sendResetMail } from './reset-mail.js';
import { RESET_RESPONSE_DELAY_MS } from './password-recovery.js';

vi.mock('./reset-mail.js', () => ({ SMTP_TIMEOUT_MS: 4000, sendResetMail: vi.fn() }));
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }));

const environment = {
  NODE_ENV: 'test',
  RODZINA_DATABASE_PATH: ':memory:',
  RODZINA_PASSWORD_RESET_EMAIL_ENABLED: 'true',
  RODZINA_SMTP_HOST: 'smtp.example.com',
  RODZINA_SMTP_USER: 'sender',
  RODZINA_SMTP_PASSWORD: 'test-secret',
  RODZINA_MAIL_FROM: 'rodzina@example.com',
  RODZINA_PUBLIC_URL: 'https://rodzina.example.com',
};
const headers = { origin: 'http://localhost:3000', host: 'localhost:3000' };

describe('password recovery', () => {
  let config: ReturnType<typeof loadConfig>;
  let database: ReturnType<typeof createDatabase>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookie: string;
  let userId: string;
  const post = (url: string, payload?: object, session?: string, ip = '192.0.2.1') =>
    app.inject({
      method: 'POST',
      url,
      ...(payload ? { payload } : {}),
      remoteAddress: ip,
      headers: { ...headers, ...(session ? { cookie: session } : {}) },
    });
  const recover = (email = 'admin@example.com', ip?: string) =>
    post('/api/auth/forgot-password', { email }, undefined, ip);
  const reset = (token: string, session?: string) =>
    post('/api/auth/reset-password', { token, password: 'newPassword123' }, session);
  const me = (session: string) => app.inject({ url: '/api/auth/me', headers: { cookie: session } });
  const token = (index = 0) => new URL(vi.mocked(sendResetMail).mock.calls[index]![1].link).pathname.split('/').pop()!;
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(sendResetMail).mockResolvedValue(undefined);
    config = loadConfig(environment);
    database = createDatabase(config);
    migrate(database.db, { migrationsFolder: './apps/api/drizzle' });
    app = await buildApp(config, database);
    const registration = await post('/api/auth/register-family', {
      familyName: 'Rodzina',
      displayName: 'Admin',
      email: 'admin@example.com',
      password: 'password123',
    });
    cookie = String(registration.headers['set-cookie']).split(';')[0]!;
    userId = registration.json().user.id;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    database.sqlite.close();
  });

  it('normalizes mail, uses the trusted public URL and stores only a hash with a 30 minute expiry', async () => {
    const before = Date.now();
    const response = await recover('  ADMIN@EXAMPLE.COM  ');
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ ok: true });
    const mail = vi.mocked(sendResetMail).mock.calls[0]![1];
    expect(mail.to).toBe('admin@example.com');
    expect(mail.link).toMatch(/^https:\/\/rodzina.example.com\/reset-hasla\/[a-f0-9]{64}$/);
    const record = database.db.select().from(passwordResets).get()!;
    expect(record.tokenHash).toBe(hashToken(token()));
    expect(record.expiresAt).toBeGreaterThanOrEqual(before + 30 * 60_000);
    expect(record.expiresAt).toBeLessThanOrEqual(Date.now() + 30 * 60_000);
    expect(record.usedAt).toBeNull();
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect((await me(cookie)).statusCode).toBe(200);
    expect(JSON.stringify(database.db.select().from(authRateLimits).all())).not.toContain('admin@example.com');
  });

  it('does not change sessions or invalidate previous links when requesting again', async () => {
    await recover();
    await recover();
    expect(
      database.db
        .select()
        .from(passwordResets)
        .all()
        .every((record) => record.usedAt === null),
    ).toBe(true);
    expect((await me(cookie)).statusCode).toBe(200);
    expect((await reset(token(0))).statusCode).toBe(200);
    expect((await reset(token(1))).statusCode).toBe(410);
  });

  it('keeps identical public responses for unknown, child, passwordless and SMTP failure cases', async () => {
    const log = vi.spyOn(app.log, 'error');
    const unknown = await recover('missing@example.com');
    expect(sendResetMail).not.toHaveBeenCalled();
    database.db.update(users).set({ passwordHash: null }).where(eq(users.id, userId)).run();
    const passwordless = await recover();
    database.db.update(users).set({ passwordHash: 'unused', role: 'child' }).where(eq(users.id, userId)).run();
    const child = await recover();
    expect(sendResetMail).not.toHaveBeenCalled();
    database.db.update(users).set({ role: 'admin' }).where(eq(users.id, userId)).run();
    vi.mocked(sendResetMail).mockRejectedValue(new Error('test-secret and token must not be logged'));
    const failed = await recover();
    for (const response of [unknown, passwordless, child, failed]) {
      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ ok: true });
    }
    expect(database.db.select().from(passwordResets).get()?.usedAt).toBeTypeOf('number');
    expect((await reset(token())).statusCode).toBe(410);
    expect(log).toHaveBeenCalledWith({ code: 'PASSWORD_RESET_DELIVERY_FAILED' }, expect.any(String));
    expect(JSON.stringify(log.mock.calls)).not.toContain('test-secret');
  });

  it.each([0, 500, 4000])('pads unknown and existing accounts after %i ms SMTP work', async (elapsed) => {
    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(elapsed)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(elapsed);
    await recover();
    await recover('unknown@example.com');
    expect(
      vi
        .mocked(delay)
        .mock.calls.slice(-2)
        .map((call) => call[0]),
    ).toEqual([RESET_RESPONSE_DELAY_MS - elapsed, RESET_RESPONSE_DELAY_MS - elapsed]);
  });

  it('revokes all own sessions and tokens atomically while preserving another account', async () => {
    const login = await post('/api/auth/login', { email: 'admin@example.com', password: 'password123' });
    const secondCookie = String(login.headers['set-cookie']).split(';')[0]!;
    const other = await post('/api/auth/register-family', {
      familyName: 'Inna rodzina',
      displayName: 'Inny admin',
      email: 'other@example.com',
      password: 'password123',
    });
    const otherCookie = String(other.headers['set-cookie']).split(';')[0]!;
    await recover();
    await recover();
    const result = await reset(token(), cookie);
    expect(result.statusCode).toBe(200);
    expect(result.json().resetOwnSession).toBe(true);
    expect(result.headers['set-cookie']).toContain('Max-Age=0');
    expect((await me(cookie)).statusCode).toBe(401);
    expect((await me(secondCookie)).statusCode).toBe(401);
    expect((await me(otherCookie)).statusCode).toBe(200);
    expect((await reset(token(1))).statusCode).toBe(410);
    expect((await post('/api/auth/login', { email: 'admin@example.com', password: 'password123' })).statusCode).toBe(
      403,
    );
    expect((await post('/api/auth/login', { email: 'admin@example.com', password: 'newPassword123' })).statusCode).toBe(
      200,
    );
  });

  it('does not end another local account session when resetting a different user', async () => {
    const other = await post('/api/auth/register-family', {
      familyName: 'Inna rodzina',
      displayName: 'Inny admin',
      email: 'other@example.com',
      password: 'password123',
    });
    const otherCookie = String(other.headers['set-cookie']).split(';')[0]!;
    await recover();
    const result = await reset(token(), otherCookie);
    expect(result.json().resetOwnSession).toBe(false);
    expect(result.headers['set-cookie']).toBeUndefined();
    expect((await me(otherCookie)).statusCode).toBe(200);
  });

  it('allows only one concurrent reset even with different valid tokens', async () => {
    await recover();
    await recover();
    const results = await Promise.all([reset(token(0)), reset(token(1))]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 410]);
  });

  it('rolls back the password and token claim if session revocation fails', async () => {
    await recover();
    const previousHash = database.db.select().from(users).where(eq(users.id, userId)).get()!.passwordHash;
    database.sqlite.exec(
      "CREATE TEMP TRIGGER fail_reset BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'test rollback'); END",
    );
    expect((await reset(token(), cookie)).statusCode).toBe(500);
    expect(database.db.select().from(passwordResets).get()?.usedAt).toBeNull();
    expect(database.db.select().from(users).where(eq(users.id, userId)).get()!.passwordHash).toBe(previousHash);
    expect((await me(cookie)).statusCode).toBe(200);
    database.sqlite.exec('DROP TRIGGER fail_reset');
    expect((await reset(token(), cookie)).statusCode).toBe(200);
  });

  it('rejects an in-flight login using the old hash after a successful reset', async () => {
    await recover();
    let complete!: (valid: boolean) => void;
    const verification = vi.spyOn(auth, 'verifyPassword').mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const pendingLogin = post('/api/auth/login', { email: 'admin@example.com', password: 'password123' });
    const result = pendingLogin.then((response) => response);
    await vi.waitFor(() => expect(verification).toHaveBeenCalledOnce());
    expect((await reset(token())).statusCode).toBe(200);
    complete(true);
    expect((await result).statusCode).toBe(403);
    expect((await result).headers['set-cookie']).toBeUndefined();
  });

  it('rejects expired and unknown tokens', async () => {
    await recover();
    database.db
      .update(passwordResets)
      .set({ expiresAt: Date.now() - 1 })
      .run();
    expect((await reset(token())).statusCode).toBe(410);
    expect((await reset('missing')).statusCode).toBe(404);
  });

  it('enforces email limits across IPs and IP limits across unknown emails, ignoring spoofed forwarding', async () => {
    for (let i = 0; i < 3; i++)
      expect((await recover(' UNKNOWN@example.com ', `192.0.2.${i + 2}`)).statusCode).toBe(202);
    const blocked = await recover('unknown@example.com');
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(3500);
    for (let i = 0; i < 10; i++)
      expect(
        (await post('/api/auth/forgot-password', { email: `missing${i}@example.com` }, undefined, '192.0.2.99'))
          .statusCode,
      ).toBe(202);
    const spoof = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      remoteAddress: '192.0.2.99',
      headers: { ...headers, 'x-forwarded-for': '203.0.113.1' },
      payload: { email: 'last@example.com' },
    });
    expect(spoof.statusCode).toBe(429);
    expect(Number(spoof.headers['retry-after'])).toBeGreaterThan(800);
  });

  it('reserves concurrent limits before sending and cleans expired counters', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => recover()));
    expect(results.filter((result) => result.statusCode === 202)).toHaveLength(3);
    expect(sendResetMail).toHaveBeenCalledTimes(3);
    database.db
      .update(authRateLimits)
      .set({ expiresAt: Date.now() - 1 })
      .run();
    expect((await recover()).statusCode).toBe(202);
    expect(
      database.db
        .select()
        .from(authRateLimits)
        .all()
        .every((record) => record.count === 1),
    ).toBe(true);
  });

  it('uses the closest untrusted hop when a proxy is explicitly trusted', async () => {
    await app.close();
    app = await buildApp({ ...config, RODZINA_TRUSTED_PROXIES: ['127.0.0.1'] }, database);
    const request = (index: number, forwarded: string) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/forgot-password',
        remoteAddress: '127.0.0.1',
        headers: { ...headers, 'x-forwarded-for': forwarded },
        payload: { email: `unknown${index}@example.com` },
      });
    for (let i = 0; i < 10; i++) expect((await request(i, '192.0.2.1, 192.0.2.100')).statusCode).toBe(202);
    expect((await request(10, '203.0.113.99, 192.0.2.100')).statusCode).toBe(429);
    expect((await request(11, '192.0.2.2, 192.0.2.101')).statusCode).toBe(202);
  });

  it('keeps limits after reopening the database and shares them across connections', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'rodzina-recovery-'));
    const diskConfig = loadConfig({ ...environment, RODZINA_DATABASE_PATH: path.join(directory, 'test.db') });
    const disk = createDatabase(diskConfig);
    migrate(disk.db, { migrationsFolder: './apps/api/drizzle' });
    const first = await buildApp(diskConfig, disk);
    try {
      for (let i = 0; i < 3; i++)
        await first.inject({
          method: 'POST',
          url: '/api/auth/forgot-password',
          headers,
          payload: { email: 'missing@example.com' },
        });
      await first.close();
      disk.sqlite.close();
      const reopened = createDatabase(diskConfig);
      const second = await buildApp(diskConfig, reopened);
      try {
        expect(
          (
            await second.inject({
              method: 'POST',
              url: '/api/auth/forgot-password',
              headers,
              payload: { email: 'MISSING@example.com' },
            })
          ).statusCode,
        ).toBe(429);
      } finally {
        await second.close();
        reopened.sqlite.close();
      }
    } finally {
      if (disk.sqlite.open) disk.sqlite.close();
      await first.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('validates public JSON, preserves mutation protections and exposes only availability', async () => {
    expect((await app.inject({ url: '/api/auth/password-recovery' })).json()).toEqual({ enabled: true });
    expect((await post('/api/auth/forgot-password', { email: 'invalid' })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: 'admin@example.com' } }))
        .statusCode,
    ).toBe(403);
    expect(sendResetMail).not.toHaveBeenCalled();
  });

  it('returns unavailable with no account lookup or limits when disabled', async () => {
    await app.close();
    app = await buildApp({ ...config, RODZINA_PASSWORD_RESET_EMAIL_ENABLED: false }, database);
    expect((await app.inject({ url: '/api/auth/password-recovery' })).json()).toEqual({ enabled: false });
    expect((await recover()).statusCode).toBe(503);
    expect(database.db.select().from(authRateLimits).all()).toEqual([]);
    expect(database.db.select().from(passwordResets).all()).toEqual([]);
    expect(sendResetMail).not.toHaveBeenCalled();
  });
});
