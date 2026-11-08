// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../db/client.js';
import { authRateLimits, contactGroups, families, pendingRegistrations, sessions, users } from '../../db/schema.js';
import { hashToken, verifyPassword } from '../../auth.js';
import { createAuthRepository } from './repository.js';
import type { sendRegistrationMail } from './registration-mail.js';

const environment = {
  NODE_ENV: 'test',
  RODZINA_DATABASE_PATH: ':memory:',
  RODZINA_PUBLIC_URL: 'https://rodzina.example.com',
  RODZINA_SMTP_HOST: 'smtp.example.com',
  RODZINA_SMTP_USER: 'test',
  RODZINA_SMTP_PASSWORD: 'secret',
  RODZINA_MAIL_FROM: 'sender@example.com',
};
const data = { familyName: 'Nowa rodzina', displayName: 'Anna', email: 'anna@example.com', password: 'password123' };
const headers = { origin: 'http://localhost:3000', host: 'localhost:3000' };

describe('email confirmation for new families', () => {
  let config: ReturnType<typeof loadConfig>;
  let database: ReturnType<typeof createDatabase>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const send = vi.fn<typeof sendRegistrationMail>();
  const post = (url: string, payload: object, ip = '192.0.2.1') =>
    app.inject({ method: 'POST', url, payload, headers, remoteAddress: ip });
  const request = (payload = data, ip?: string) => post('/api/auth/registration-requests', payload, ip);
  const token = (index = 0) =>
    new URLSearchParams(new URL(send.mock.calls[index]![1].link).hash.slice(1)).get('token')!;
  const confirm = (value = token()) => post('/api/auth/confirm-registration', { token: value });
  const emptyAccounts = () => {
    expect(database.db.select().from(families).all()).toEqual([]);
    expect(database.db.select().from(users).all()).toEqual([]);
    expect(database.db.select().from(sessions).all()).toEqual([]);
    expect(database.db.select().from(contactGroups).all()).toEqual([]);
  };
  beforeEach(async () => {
    send.mockReset().mockResolvedValue(undefined);
    config = loadConfig(environment);
    database = createDatabase(config);
    migrate(database.db, { migrationsFolder: './apps/api/drizzle' });
    app = await buildApp(config, database, undefined, send);
  });
  afterEach(async () => {
    await app.close();
    database.sqlite.close();
    vi.restoreAllMocks();
  });

  it('stores only a pending request until explicit confirmation, then allows normal login', async () => {
    const response = await request({ ...data, email: ' ANNA@EXAMPLE.COM ' });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ ok: true });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    emptyAccounts();
    const pending = database.db.select().from(pendingRegistrations).get()!;
    expect(pending).toMatchObject({ email: data.email, tokenHash: hashToken(token()), ready: true });
    expect(pending.expiresAt - pending.createdAt).toBe(24 * 60 * 60_000);
    expect(await verifyPassword(pending.passwordHash, data.password)).toBe(true);
    expect(JSON.stringify(pending)).not.toContain(token());
    expect(JSON.stringify(pending)).not.toContain(data.password);
    expect(send.mock.calls[0]![1].link).toMatch(
      /^https:\/\/rodzina.example.com\/potwierdz-rodzine#token=[a-f0-9]{64}$/,
    );
    expect((await post('/api/auth/login', data)).statusCode).toBe(403);
    expect((await app.inject({ url: '/potwierdz-rodzine' })).statusCode).toBe(404);
    emptyAccounts();
    const confirmed = await confirm();
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.headers['set-cookie']).toBeUndefined();
    expect(database.db.select().from(families).all()).toHaveLength(1);
    expect(database.db.select().from(users).all()).toMatchObject([{ email: data.email, role: 'admin' }]);
    expect(database.db.select().from(contactGroups).all().length).toBeGreaterThan(0);
    expect(database.db.select().from(pendingRegistrations).all()).toEqual([]);
    expect(database.db.select().from(sessions).all()).toEqual([]);
    expect((await confirm()).statusCode).toBe(410);
    expect((await post('/api/auth/login', data)).statusCode).toBe(200);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('does not let old clients bypass confirmation or receive an incomplete session', async () => {
    const response = await post('/api/auth/register-family', data);
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toMatchObject({ code: 'EMAIL_CONFIRMATION_REQUIRED' });
    expect(response.json().error.message).toContain('Sprawdź pocztę');
    expect(send).toHaveBeenCalledOnce();
    emptyAccounts();
    expect((await confirm()).statusCode).toBe(200);
    expect((await post('/api/auth/login', data)).statusCode).toBe(200);
  });

  it('allows only one concurrent confirmation even across different links for one address', async () => {
    await request();
    await request({ ...data, password: 'anotherPassword', familyName: 'Druga nazwa' });
    const responses = await Promise.all([confirm(token(0)), confirm(token(1)), confirm(token(0))]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 410, 410]);
    expect(database.db.select().from(families).all()).toHaveLength(1);
    expect(database.db.select().from(users).all()).toHaveLength(1);
    expect(database.db.select().from(pendingRegistrations).all()).toEqual([]);
    expect((await post('/api/auth/login', data)).statusCode).toBe(200);
  });

  it('expires links and removes temporary personal data without creating accounts', async () => {
    await request();
    database.db
      .update(pendingRegistrations)
      .set({ expiresAt: Date.now() - 1 })
      .run();
    expect((await confirm()).statusCode).toBe(410);
    expect(database.db.select().from(pendingRegistrations).all()).toEqual([]);
    emptyAccounts();
    expect((await confirm('a'.repeat(64))).statusCode).toBe(410);
    expect((await confirm('invalid')).statusCode).toBe(400);
  });

  it('invalidates failed SMTP delivery and retains the previous valid request', async () => {
    await request();
    send.mockRejectedValueOnce(new Error('private SMTP details'));
    const response = await request();
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('private SMTP');
    expect((await confirm(token(1))).statusCode).toBe(410);
    emptyAccounts();
    expect(database.db.select().from(pendingRegistrations).all()).toHaveLength(1);
    expect((await confirm(token(0))).statusCode).toBe(200);
  });

  it('cannot confirm while SMTP has not acknowledged delivery', async () => {
    send.mockImplementationOnce(async () => {
      expect((await confirm()).statusCode).toBe(410);
      emptyAccounts();
    });
    expect((await request()).statusCode).toBe(202);
    expect((await confirm()).statusCode).toBe(200);
  });

  it('rolls back both account creation and token consumption on a database failure', async () => {
    await request();
    database.sqlite.exec(
      "CREATE TRIGGER fail_groups BEFORE INSERT ON contact_groups BEGIN SELECT RAISE(ABORT, 'test'); END",
    );
    expect((await confirm()).statusCode).toBe(500);
    emptyAccounts();
    expect(database.db.select().from(pendingRegistrations).all()).toHaveLength(1);
    database.sqlite.exec('DROP TRIGGER fail_groups');
    expect((await confirm()).statusCode).toBe(200);
  });

  it('keeps existing accounts and sessions unchanged and handles a competing invitation', async () => {
    await request();
    const pending = database.db.select().from(pendingRegistrations).get()!;
    createAuthRepository(database).registerFamily({
      familyId: 'existing-family',
      userId: 'existing-user',
      familyName: 'Existing',
      displayName: 'Existing admin',
      normalizedEmail: data.email,
      passwordHash: pending.passwordHash,
      now: Date.now(),
    });
    const login = await post('/api/auth/login', data);
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    expect((await confirm()).statusCode).toBe(409);
    expect((await request()).statusCode).toBe(409);
    expect((await app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(200);
    expect(database.db.select().from(families).all()).toMatchObject([{ id: 'existing-family', name: 'Existing' }]);
    expect(database.db.select().from(users).all()).toHaveLength(1);
    expect(send).toHaveBeenCalledOnce();
  });

  it('enforces persistent email limits across IPs and service restarts', async () => {
    for (let i = 0; i < 3; i++)
      expect((await request({ ...data, email: ' ANNA@EXAMPLE.COM ' }, `192.0.2.${i}`)).statusCode).toBe(202);
    await app.close();
    app = await buildApp(config, database, undefined, send);
    const response = await request();
    expect(response.statusCode).toBe(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(send).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(database.db.select().from(authRateLimits).all())).not.toContain(data.email);
    database.db
      .update(authRateLimits)
      .set({ expiresAt: Date.now() - 1 })
      .run();
    expect((await request()).statusCode).toBe(202);
  });

  it('limits IP attempts across addresses including SMTP errors', async () => {
    send.mockRejectedValue(new Error('unavailable'));
    for (let i = 0; i < 10; i++)
      expect((await request({ ...data, email: `new-${i}@example.com` })).statusCode).toBe(503);
    const response = await request({ ...data, email: 'another@example.com' });
    expect(response.statusCode).toBe(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    emptyAccounts();
  }, 20000);

  it('fails closed when registration is disabled or SMTP is missing and blocks CSRF', async () => {
    const csrf = await app.inject({
      method: 'POST',
      url: '/api/auth/registration-requests',
      payload: data,
      headers: { ...headers, origin: 'https://evil.example' },
    });
    expect(csrf.statusCode).toBe(403);
    await request();
    config.RODZINA_ALLOW_REGISTRATION = false;
    expect((await request()).statusCode).toBe(403);
    expect((await confirm()).statusCode).toBe(403);
    config.RODZINA_ALLOW_REGISTRATION = true;
    config.RODZINA_SMTP_HOST = '';
    expect((await request()).statusCode).toBe(503);
    emptyAccounts();
    expect(send).toHaveBeenCalledOnce();
  });

  it('never exposes a test seeding endpoint in the production application', async () => {
    expect((await post('/api/test/families', data)).statusCode).toBe(404);
  });
});
