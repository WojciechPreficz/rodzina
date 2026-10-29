// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import * as auth from '../../auth.js';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../db/client.js';
import * as schema from '../../db/schema.js';

const password = 'password123';
const passwordHash = await auth.hashPassword(password);
const headers = { origin: 'http://localhost:3000', host: 'localhost:3000' };

describe('account deletion', () => {
  let database: ReturnType<typeof createDatabase>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let familyId: string;
  let admin: ReturnType<typeof actor>;
  let member: ReturnType<typeof actor>;
  let child: ReturnType<typeof actor>;
  let otherAdult: ReturnType<typeof actor>;

  function actor(role: 'admin' | 'member' | 'child', family = familyId) {
    const id = randomUUID();
    const token = randomUUID();
    const sessionId = auth.hashToken(token);
    database.db
      .insert(schema.users)
      .values({
        id,
        familyId: family,
        displayName: role,
        role,
        email: role === 'child' ? null : `${id}@example.com`,
        passwordHash: role === 'child' ? null : passwordHash,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    database.db
      .insert(schema.sessions)
      .values({ id: sessionId, userId: id, createdAt: 1, expiresAt: Date.now() + 3_600_000 })
      .run();
    return { id, cookie: `sid=${token}`, sessionId };
  }
  function family() {
    const id = randomUUID();
    database.db.insert(schema.families).values({ id, name: 'Test Family', joinCode: id, createdAt: 1 }).run();
    return id;
  }
  function remove(url: string, user = admin, body: unknown = { password }) {
    return app.inject({
      method: 'DELETE',
      url,
      headers: { ...headers, cookie: user.cookie },
      ...(body === undefined
        ? {}
        : {
            payload: JSON.stringify(body),
            headers: { ...headers, cookie: user.cookie, 'content-type': 'application/json' },
          }),
    });
  }
  function findUser(id: string) {
    return database.db.select().from(schema.users).where(eq(schema.users.id, id)).get();
  }
  function seedData(owner = member) {
    const id = randomUUID();
    const base = { id, familyId, createdAt: 1, updatedAt: 1, createdBy: owner.id };
    database.db
      .insert(schema.taskLists)
      .values({ id, familyId, ownerId: owner.id, name: 'Private', createdAt: 1, updatedAt: 1 })
      .run();
    database.db
      .insert(schema.tasks)
      .values({
        id,
        listId: id,
        title: 'Task',
        assigneeId: owner.id,
        doneBy: owner.id,
        createdBy: owner.id,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    database.db
      .insert(schema.events)
      .values({ ...base, title: 'Event', startDate: '2026-11-01', datePrecision: 'day', kind: 'single' })
      .run();
    database.db.insert(schema.eventParticipants).values({ eventId: id, userId: owner.id }).run();
    database.db.insert(schema.eventExceptions).values({ id, eventId: id, originalDate: '2026-11-01' }).run();
    database.db
      .insert(schema.documents)
      .values({ ...base, type: 'other', label: 'Document', holderUserId: owner.id, expiresOn: '2027-01-01' })
      .run();
    database.db
      .insert(schema.reminders)
      .values({
        id,
        familyId,
        eventId: id,
        type: 'absolute',
        remindAt: 1,
        audience: 'user',
        userId: owner.id,
        createdBy: owner.id,
      })
      .run();
    database.db
      .insert(schema.contactGroups)
      .values({ ...base, name: 'Group', isDefault: true })
      .run();
    database.db
      .insert(schema.contacts)
      .values({ ...base, groupId: id, name: 'Contact' })
      .run();
    database.db
      .insert(schema.shoppingLists)
      .values({ ...base, name: 'Shopping' })
      .run();
    database.db
      .insert(schema.shoppingItems)
      .values({ id, listId: id, name: 'Milk', createdBy: owner.id, checkedBy: owner.id, createdAt: 1, updatedAt: 1 })
      .run();
    database.db
      .insert(schema.shoppingHistory)
      .values({ familyId, nameNormalized: 'milk', displayName: 'Milk', category: 'other', useCount: 1, lastUsedAt: 1 })
      .run();
    database.db
      .insert(schema.meals)
      .values({ ...base, date: '2026-11-01', title: 'Dinner' })
      .run();
    database.db.insert(schema.mealIngredients).values({ id, mealId: id, name: 'Milk', position: 0 }).run();
    database.db.insert(schema.mealShoppingExports).values({ mealId: id, listId: id, createdAt: 1 }).run();
    database.db
      .insert(schema.shoppingOperations)
      .values({ id, userId: owner.id, fingerprint: 'test', response: '{}', status: 200 })
      .run();
    database.db
      .insert(schema.taskOperations)
      .values({ id, userId: owner.id, listId: id, fingerprint: 'test', response: '{}', status: 200 })
      .run();
    database.db
      .insert(schema.invitations)
      .values({ id, familyId, createdBy: owner.id, role: 'member', tokenHash: id, expiresAt: Date.now() + 60_000 })
      .run();
    database.db
      .insert(schema.passwordResets)
      .values({ id, userId: owner.id, tokenHash: id, expiresAt: Date.now() + 60_000 })
      .run();
    return id;
  }

  beforeEach(async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      RODZINA_DATABASE_PATH: ':memory:',
      RODZINA_PUBLIC_URL: 'http://localhost:3000',
    });
    database = createDatabase(config);
    migrate(database.db, { migrationsFolder: './apps/api/drizzle' });
    app = await buildApp(config, database);
    familyId = family();
    admin = actor('admin');
    member = actor('member');
    child = actor('child');
    otherAdult = actor('member');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
    database.sqlite.close();
  });

  it.each([
    ['admin', 'member', 200],
    ['admin', 'child', 200],
    ['member', 'child', 200],
    ['member', 'member', 200],
    ['member', 'admin', 403],
    ['member', 'otherAdult', 403],
    ['child', 'admin', 403],
    ['child', 'member', 403],
    ['child', 'child', 403],
  ] as const)('%s deleting %s returns %i', async (actorName, targetName, status) => {
    const actors = { admin, member, child, otherAdult };
    const target = actors[targetName];
    const response = await remove(`/api/members/${target.id}`, actors[actorName]);
    expect(response.statusCode, response.body).toBe(status);
    expect(Boolean(findUser(target.id))).toBe(status !== 200);
    if (status === 200) expect(response.json().resetOwnSession).toBe(actorName === targetName);
  });

  it('protects the last admin but allows self-deletion after promoting another adult', async () => {
    expect((await remove(`/api/members/${admin.id}`)).json().error.code).toBe('LAST_ADMIN');
    database.db.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.id, member.id)).run();
    const result = await remove(`/api/members/${admin.id}`);
    expect(result.statusCode).toBe(200);
    expect(result.headers['set-cookie']).toContain('sid=;');
    expect(findUser(child.id)).toBeDefined();
    expect((await app.inject({ url: '/api/auth/me', headers: { cookie: admin.cookie } })).statusCode).toBe(401);
  });

  it('rejects missing or incorrect credentials without ending the actor session', async () => {
    const legacy = await app.inject({
      method: 'DELETE',
      url: `/api/members/${child.id}`,
      headers: { ...headers, cookie: admin.cookie },
    });
    expect(legacy.statusCode).toBe(409);
    expect(legacy.json().error.code).toBe('ACCOUNT_DELETION_UPDATE_REQUIRED');
    const incorrect = await remove(`/api/members/${child.id}`, admin, { password: 'wrong' });
    expect(incorrect.statusCode).toBe(403);
    expect(incorrect.json().error.code).toBe('INVALID_CREDENTIALS');
    expect(incorrect.headers['set-cookie']).toBeUndefined();
    expect((await app.inject({ url: '/api/auth/me', headers: { cookie: admin.cookie } })).statusCode).toBe(200);
  });

  it('shares a persistent credential limit across both deletion actions', async () => {
    for (let i = 0; i < 10; i++)
      expect((await remove(`/api/members/${child.id}`, admin, { password: 'wrong' })).statusCode).toBe(403);
    await app.close();
    app = await buildApp(
      loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:', RODZINA_PUBLIC_URL: 'http://localhost:3000' }),
      database,
    );
    const blocked = await remove('/api/family', admin, { password, confirmationName: 'Test Family' });
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect((await remove(`/api/members/${child.id}`, member)).statusCode).toBe(200);
  });

  it('requires administrator rights, the current family name and trusted origin', async () => {
    for (const user of [member, child])
      expect((await remove('/api/family', user, { password, confirmationName: 'Test Family' })).statusCode).toBe(403);
    expect((await remove('/api/family', admin, { password, confirmationName: 'Wrong' })).statusCode).toBe(400);
    const foreign = actor('admin', family());
    expect((await remove(`/api/members/${foreign.id}`)).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/api/family',
          headers: { ...headers, origin: 'http://evil.test', cookie: admin.cookie },
          payload: { password, confirmationName: 'Test Family' },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('removes every family-owned table and preserves a second family', async () => {
    seedData();
    const foreignFamily = family();
    const foreign = actor('admin', foreignFamily);
    const result = await remove('/api/family', admin, { password, confirmationName: ' Test Family ' });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json().resetOwnSession).toBe(true);
    expect(result.headers['set-cookie']).toContain('sid=;');
    const allowed = new Set(['families', 'users', 'sessions', 'auth_rate_limits', 'job_runs']);
    const tables = database.sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%drizzle%'",
      )
      .all() as { name: string }[];
    for (const { name } of tables)
      if (!allowed.has(name))
        expect(database.sqlite.prepare(`SELECT count(*) AS count FROM "${name}"`).get(), name).toEqual({ count: 0 });
    expect(
      database.db
        .select()
        .from(schema.users)
        .all()
        .map((user) => user.id),
    ).toEqual([foreign.id]);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
    expect((await app.inject({ url: '/api/auth/me', headers: { cookie: foreign.cookie } })).statusCode).toBe(200);
    for (const user of [admin, member, child])
      expect((await app.inject({ url: '/api/auth/me', headers: { cookie: user.cookie } })).statusCode).toBe(401);
  });

  it('keeps shared content, transfers shared task lists and removes private data', async () => {
    const id = seedData();
    const sharedId = randomUUID();
    database.db
      .insert(schema.taskLists)
      .values({ id: sharedId, familyId, ownerId: member.id, name: 'Shared', createdAt: 1, updatedAt: 1 })
      .run();
    database.db.insert(schema.taskListMembers).values({ listId: sharedId, userId: admin.id }).run();
    const result = await remove(`/api/members/${member.id}`);
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json().resetOwnSession).toBe(false);
    expect(database.db.select().from(schema.taskLists).where(eq(schema.taskLists.id, sharedId)).get()).toMatchObject({
      ownerId: admin.id,
      isDefault: false,
    });
    expect(database.db.select().from(schema.taskLists).where(eq(schema.taskLists.id, id)).get()).toBeUndefined();
    expect(database.db.select().from(schema.events).get()).toMatchObject({ id, createdBy: null });
    expect(database.db.select().from(schema.documents).get()).toMatchObject({
      id,
      holderUserId: null,
      createdBy: null,
    });
    for (const table of [schema.shoppingLists, schema.meals, schema.contacts])
      expect(database.db.select().from(table).all()).toHaveLength(1);
    for (const table of [schema.reminders, schema.passwordResets, schema.invitations, schema.shoppingOperations])
      expect(database.db.select().from(table).all()).toHaveLength(0);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it.each(['member', 'family'])('rolls back all %s deletion changes on failure', async (target) => {
    const id = seedData();
    database.sqlite.exec(
      "CREATE TRIGGER reject_deletion BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'test failure'); END",
    );
    const result =
      target === 'family'
        ? await remove('/api/family', admin, { password, confirmationName: 'Test Family' })
        : await remove(`/api/members/${member.id}`);
    expect(result.statusCode).toBe(500);
    expect(findUser(member.id)).toBeDefined();
    expect(database.db.select().from(schema.taskLists).where(eq(schema.taskLists.id, id)).get()).toBeDefined();
    expect(
      database.db.select().from(schema.sessions).where(eq(schema.sessions.id, member.sessionId)).get(),
    ).toBeDefined();
    expect(database.db.select().from(schema.contacts).all()).toHaveLength(1);
  });

  it.each(['session', 'password', 'role'] as const)(
    'rechecks %s after asynchronous password verification',
    async (change) => {
      const original = auth.verifyPassword;
      vi.spyOn(auth, 'verifyPassword').mockImplementation(async (...args) => {
        const valid = await original(...args);
        if (change === 'session')
          database.db.delete(schema.sessions).where(eq(schema.sessions.id, admin.sessionId)).run();
        if (change === 'password')
          database.db.update(schema.users).set({ passwordHash: 'changed' }).where(eq(schema.users.id, admin.id)).run();
        if (change === 'role')
          database.db.update(schema.users).set({ role: 'member' }).where(eq(schema.users.id, admin.id)).run();
        return valid;
      });
      const response = await remove('/api/family', admin, { password, confirmationName: 'Test Family' });
      expect(response.statusCode).toBe(change === 'session' ? 401 : 403);
      expect(findUser(child.id)).toBeDefined();
    },
  );

  it('allows only one of two concurrent administrator self-deletions', async () => {
    database.db.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.id, member.id)).run();
    const results = await Promise.all([
      remove(`/api/members/${admin.id}`),
      remove(`/api/members/${member.id}`, member),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    expect(
      database.db
        .select()
        .from(schema.users)
        .all()
        .filter((user) => user.role === 'admin'),
    ).toHaveLength(1);
  });
});
