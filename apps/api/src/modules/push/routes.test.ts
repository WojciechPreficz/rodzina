// @vitest-environment node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { hashToken } from '../../auth.js';
import { loadTestConfig } from '../../config.test-utils.js';
import { createDatabase } from '../../db/client.js';
import { families, users, sessions, pushSubscriptions } from '../../db/schema.js';
import type { PushSender } from './sender.js';

const config = loadTestConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' });
const subscription = {
  endpoint: 'https://push.example.com/device',
  keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) },
};
describe('push API', () => {
  let database: ReturnType<typeof createDatabase>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  const send = vi.fn<PushSender['send']>();
  function request(method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown, actor = 'admin') {
    return app.inject({
      method,
      url,
      headers: {
        cookie: `sid=${actor}`,
        origin: 'http://localhost',
        host: 'localhost',
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });
  }
  const subscribe = (actor = 'admin', endpoint = subscription.endpoint) =>
    request('POST', '/api/push/subscriptions', { ...subscription, endpoint }, actor);
  const rows = () => database.db.select().from(pushSubscriptions).all();
  beforeEach(async () => {
    database = createDatabase(config);
    migrate(database.db, {
      migrationsFolder: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle'),
    });
    for (const familyId of ['family', 'other'])
      database.db.insert(families).values({ id: familyId, name: familyId, joinCode: familyId, createdAt: 0 }).run();
    for (const id of ['admin', 'member', 'child', 'outsider']) {
      database.db
        .insert(users)
        .values({
          id,
          familyId: id === 'outsider' ? 'other' : 'family',
          displayName: id,
          role: id === 'admin' ? 'admin' : id === 'child' ? 'child' : 'member',
          createdAt: 0,
          updatedAt: 0,
        })
        .run();
      database.db
        .insert(sessions)
        .values({ id: hashToken(id), userId: id, createdAt: 0, expiresAt: Date.now() + 86400000 })
        .run();
    }
    send.mockReset().mockResolvedValue(undefined);
    app = await buildApp(config, database, { pushSender: { send } });
  });
  afterEach(async () => {
    await app.close();
    database.sqlite.close();
  });

  it('exposes only the public VAPID key to authenticated users', async () => {
    const response = await request('GET', '/api/push/public-key');
    expect(response.json()).toEqual({ ok: true, publicKey: config.RODZINA_VAPID_PUBLIC_KEY });
    expect(response.body).not.toContain(config.RODZINA_VAPID_PRIVATE_KEY);
  });
  it('upserts a browser subscription without changing its identity or creation time', async () => {
    expect((await subscribe()).statusCode).toBe(200);
    const original = rows()[0]!;
    expect(original.id).toMatch(/^[0-9a-f-]{36}$/);
    const next = { ...subscription, keys: { p256dh: 'C'.repeat(87), auth: 'D'.repeat(22) }, expirationTime: null };
    expect((await request('POST', '/api/push/subscriptions', next)).statusCode).toBe(200);
    expect(rows()).toEqual([{ ...original, ...next.keys }]);
  });
  it.each(['member', 'child', 'outsider'])(
    'prevents %s from overwriting or deleting another subscription',
    async (actor) => {
      await subscribe();
      const original = rows();
      expect((await subscribe(actor)).statusCode).toBe(409);
      expect(
        (await request('DELETE', '/api/push/subscriptions', { endpoint: subscription.endpoint }, actor)).statusCode,
      ).toBe(200);
      expect(rows()).toEqual(original);
      expect((await request('POST', '/api/push/test', undefined, actor)).json().sent).toBe(0);
      expect(send).not.toHaveBeenCalled();
    },
  );
  it('allows children to subscribe and remove only their own device idempotently', async () => {
    expect((await subscribe('child')).statusCode).toBe(200);
    for (let i = 0; i < 2; i++)
      expect(
        (await request('DELETE', '/api/push/subscriptions', { endpoint: subscription.endpoint }, 'child')).statusCode,
      ).toBe(200);
    expect(rows()).toEqual([]);
  });
  it('sends tests to every device of the current user and records successes', async () => {
    await subscribe();
    await subscribe('admin', `${subscription.endpoint}/second`);
    await subscribe('child', `${subscription.endpoint}/child`);
    await subscribe('outsider', `${subscription.endpoint}/outsider`);
    const response = await request('POST', '/api/push/test');
    expect(response.json()).toEqual({ ok: true, sent: 2, failed: 0, removed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    for (const [device, payload] of send.mock.calls) {
      expect(device.endpoint).not.toMatch(/child|outsider/);
      expect(payload).toMatchObject({
        title: 'Rodzina — powiadomienie testowe',
        tag: 'rodzina-push-test',
        url: '/kalendarz',
      });
    }
    expect(rows().filter((row) => row.lastSuccessAt !== null)).toHaveLength(2);
  });
  it('removes expired devices and continues after provider failures without exposing errors', async () => {
    await subscribe();
    await subscribe('admin', `${subscription.endpoint}/second`);
    await subscribe('admin', `${subscription.endpoint}/third`);
    send.mockRejectedValueOnce({ statusCode: 410 }).mockRejectedValueOnce({ statusCode: 503, body: 'secret' });
    const response = await request('POST', '/api/push/test');
    expect(response.json()).toEqual({ ok: true, sent: 1, failed: 1, removed: 1 });
    expect(rows()).toHaveLength(2);
    expect(response.body).not.toContain('secret');
  });
  it.each([
    ['GET', '/api/push/public-key', undefined],
    ['POST', '/api/push/subscriptions', subscription],
    ['DELETE', '/api/push/subscriptions', { endpoint: subscription.endpoint }],
    ['POST', '/api/push/test', undefined],
  ] as const)('requires a session for %s %s', async (method, url, payload) => {
    const response = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });
  it.each([
    {},
    { ...subscription, endpoint: 'not-a-url' },
    { ...subscription, endpoint: 'http://push.example.com/device' },
    { ...subscription, keys: { p256dh: 'invalid', auth: 'invalid' } },
    { ...subscription, userId: randomUUID() },
  ])('rejects invalid subscription input', async (payload) => {
    const response = await request('POST', '/api/push/subscriptions', payload);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(rows()).toHaveLength(0);
  });
  it('rejects invalid deletion and foreign origins', async () => {
    expect((await request('DELETE', '/api/push/subscriptions', {})).statusCode).toBe(400);
    const response = await app.inject({
      method: 'POST',
      url: '/api/push/subscriptions',
      payload: subscription,
      headers: { cookie: 'sid=admin', origin: 'https://foreign.example', host: 'localhost' },
    });
    expect(response.statusCode).toBe(403);
    expect(rows()).toHaveLength(0);
  });
});
