// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mealResponseSchema, mealWeekResponseSchema } from '@rodzina/shared';
import { buildApp } from '../../app.js';
import { hashToken } from '../../auth.js';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../db/client.js';
import * as schema from '../../db/schema.js';

describe('meals API', () => {
  let database: ReturnType<typeof createDatabase>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let familyId: string;
  let admin: { id: string; cookie: string };
  let member: typeof admin;
  let child: typeof admin;
  let outsider: typeof admin;
  const start = '2026-10-19';
  const target = '2026-10-26';
  const meal = {
    title: ' Zupa ',
    notes: ' Notatka ',
    ingredients: [{ name: ' Marchew ', quantity: ' 500 g ' }, { name: 'Woda' }],
  };
  function family() {
    const id = randomUUID();
    database.db.insert(schema.families).values({ id, name: 'Rodzina', joinCode: id, createdAt: 1 }).run();
    return id;
  }
  function actor(familyId: string, role: 'admin' | 'member' | 'child') {
    const id = randomUUID();
    const token = randomUUID();
    database.db
      .insert(schema.users)
      .values({ id, familyId, displayName: role, role, createdAt: 1, updatedAt: 1 })
      .run();
    database.db
      .insert(schema.sessions)
      .values({ id: hashToken(token), userId: id, expiresAt: Date.now() + 86400000, createdAt: Date.now() })
      .run();
    return { id, cookie: `sid=${token}` };
  }
  function request(method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, payload?: unknown, user = admin) {
    return app.inject({
      method,
      url,
      headers: {
        cookie: user.cookie,
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      ...(method === 'GET' ? {} : { payload: JSON.stringify(payload ?? {}) }),
    });
  }
  async function put(date = start, payload: unknown = meal, user = admin) {
    const response = await request('PUT', `/api/meals/${date}/dinner`, payload, user);
    expect(response.statusCode, response.body).toBe(200);
    return mealResponseSchema.parse(response.json()).meal;
  }
  async function week(weekStart = start, user = admin) {
    const response = await request('GET', `/api/meals?weekStart=${weekStart}`, undefined, user);
    expect(response.statusCode, response.body).toBe(200);
    return mealWeekResponseSchema.parse(response.json());
  }
  function copy(overwrite = false, user = admin) {
    return request('POST', '/api/meals/copy-week', { fromWeekStart: start, toWeekStart: target, overwrite }, user);
  }
  beforeEach(async () => {
    const config = loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' });
    database = createDatabase(config);
    migrate(database.db, { migrationsFolder: './apps/api/drizzle' });
    familyId = family();
    admin = actor(familyId, 'admin');
    member = actor(familyId, 'member');
    child = actor(familyId, 'child');
    outsider = actor(family(), 'admin');
    app = await buildApp(config, database);
  });
  afterEach(async () => {
    await app?.close();
    database?.sqlite.close();
  });

  it('returns all seven days, upserts with stable identity and replaces ordered ingredients', async () => {
    expect((await week()).days.map((day) => day.date)).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ]);
    const first = await put(start, meal, member);
    expect(first).toMatchObject({
      familyId,
      createdBy: member.id,
      title: 'Zupa',
      notes: 'Notatka',
      ingredients: [
        { name: 'Marchew', quantity: '500 g' },
        { name: 'Woda', quantity: null },
      ],
    });
    const updated = await put(start, { title: 'Makaron', ingredients: [{ name: 'Sól', quantity: '' }] });
    expect(updated).toMatchObject({
      id: first.id,
      createdBy: member.id,
      createdAt: first.createdAt,
      notes: null,
      ingredients: [{ name: 'Sól', quantity: null }],
    });
    expect(updated.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
    await put('2026-10-25', { title: 'Niedziela', ingredients: [] });
    await put(target);
    expect((await week()).days.flatMap((day) => day.meals)).toHaveLength(2);
    expect((await request('DELETE', `/api/meals/${start}/dinner`, {}, member)).statusCode).toBe(200);
    expect(
      database.db.select().from(schema.mealIngredients).where(eq(schema.mealIngredients.mealId, first.id)).all(),
    ).toEqual([]);
    expect((await request('DELETE', `/api/meals/${start}/dinner`)).statusCode).toBe(404);
  });
  it('copies across DST without overwriting and selectively overwrites occupied days', async () => {
    const source = await put();
    await put('2026-10-25', { title: 'Niedziela', ingredients: [] });
    const occupied = await put(target, { title: 'Zachowaj', ingredients: [] });
    const untouched = await put('2026-10-27');
    expect((await copy()).json()).toEqual({ ok: true, copied: 1 });
    let result = (await week(target)).days.flatMap((day) => day.meals);
    expect(result.find((item) => item.date === target)).toEqual(occupied);
    expect(result.find((item) => item.date === '2026-11-01')?.title).toBe('Niedziela');
    expect((await copy(true, member)).json()).toEqual({ ok: true, copied: 2 });
    result = (await week(target)).days.flatMap((day) => day.meals);
    expect(result.find((item) => item.date === target)).toMatchObject({
      id: occupied.id,
      title: source.title,
      ingredients: source.ingredients,
    });
    expect(result.find((item) => item.id === untouched.id)).toEqual(untouched);
    expect(await week()).toMatchObject({ days: [{ meals: [source] }, {}, {}, {}, {}, {}, {}] });
    await put(start, { title: 'Zmiana', ingredients: [] });
    expect((await week(target)).days[0]!.meals[0]!.ingredients).toEqual(source.ingredients);
    expect(
      (
        await request('POST', '/api/meals/copy-week', {
          fromWeekStart: '2026-11-09',
          toWeekStart: target,
          overwrite: true,
        })
      ).json().copied,
    ).toBe(0);
  });
  it('returns distinct matching titles with ingredients from their most recent save', async () => {
    const old = await put(start, { title: 'Żurek', ingredients: [{ name: 'Stary składnik' }] });
    database.db.update(schema.meals).set({ updatedAt: 1 }).where(eq(schema.meals.id, old.id)).run();
    await put('2026-10-20', { title: 'ŻUREK', ingredients: [{ name: 'Zakwas', quantity: '1 l' }] });
    await put('2026-10-21', { title: 'Zupa', ingredients: [] });
    await put(start, { title: 'Żurek obcy', ingredients: [] }, outsider);
    const response = await request('GET', '/api/meals/suggestions?q=%C5%BCu', undefined, child);
    expect(response.statusCode).toBe(200);
    expect(response.json().suggestions).toEqual([
      { title: 'ŻUREK', ingredients: [{ name: 'Zakwas', quantity: '1 l' }] },
    ]);
    expect((await request('GET', '/api/meals/suggestions?q=%25')).json().suggestions).toEqual([]);
    expect((await request('GET', '/api/meals/suggestions')).json().suggestions).toHaveLength(2);
  });
  it('allows child reads, requires authentication and denies all child mutations', async () => {
    await put();
    const before = await week();
    expect(await week(start, child)).toEqual(before);
    for (const [method, url, payload] of [
      ['PUT', `/api/meals/${start}/dinner`, meal],
      ['DELETE', `/api/meals/${start}/dinner`, {}],
      ['POST', '/api/meals/copy-week', { fromWeekStart: start, toWeekStart: target, overwrite: true }],
    ] as const) {
      expect((await request(method, url, payload, child)).statusCode).toBe(403);
      expect(
        (
          await app.inject({
            method,
            url,
            payload,
            headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
          })
        ).statusCode,
      ).toBe(401);
    }
    for (const url of ['/api/meals?weekStart=' + start, '/api/meals/suggestions']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    }
    expect(await week()).toEqual(before);
  });
  it('isolates week reads, upserts, deletion, suggestions and copies by family', async () => {
    await put();
    expect((await week(start, outsider)).days.every((day) => !day.meals.length)).toBe(true);
    expect((await copy(true, outsider)).json().copied).toBe(0);
    expect((await request('DELETE', `/api/meals/${start}/dinner`, {}, outsider)).statusCode).toBe(404);
    const before = await week();
    await put(start, { title: 'Obcy', ingredients: [] }, outsider);
    expect(await week()).toEqual(before);
    expect((await request('GET', '/api/meals/suggestions', undefined, outsider)).json().suggestions).toEqual([
      { title: 'Obcy', ingredients: [] },
    ]);
  });
  it('validates calendar dates, Monday weeks, dinner slot, limits and ownership injection', async () => {
    for (const value of ['2026-10-20', '2026-02-30', 'bad', '9999-12-27']) {
      expect((await request('GET', `/api/meals?weekStart=${value}`)).statusCode).toBe(400);
      for (const field of ['fromWeekStart', 'toWeekStart'])
        expect(
          (
            await request('POST', '/api/meals/copy-week', {
              fromWeekStart: start,
              toWeekStart: target,
              overwrite: false,
              [field]: value,
            })
          ).statusCode,
        ).toBe(400);
    }
    expect((await request('GET', '/api/meals')).statusCode).toBe(400);
    for (const path of ['2026-02-30/dinner', `${start}/breakfast`]) {
      expect((await request('PUT', `/api/meals/${path}`, meal)).statusCode).toBe(400);
      expect((await request('DELETE', `/api/meals/${path}`)).statusCode).toBe(400);
    }
    for (const data of [
      { title: ' ' },
      { title: 'a'.repeat(201) },
      { notes: 'a'.repeat(5001) },
      { ingredients: [{ name: ' ' }] },
      { ingredients: [{ name: 'x', quantity: 'x'.repeat(201) }] },
      { ingredients: Array.from({ length: 101 }, () => ({ name: 'x' })) },
      { ingredients: null },
      { familyId: outsider.id },
      { createdBy: outsider.id },
    ])
      expect((await request('PUT', `/api/meals/${start}/dinner`, { ...meal, ...data })).statusCode).toBe(400);
    for (const data of [
      { fromWeekStart: start, toWeekStart: start, overwrite: false },
      { fromWeekStart: start, toWeekStart: target },
      { fromWeekStart: start, toWeekStart: target, overwrite: 'false' },
    ])
      expect((await request('POST', '/api/meals/copy-week', data)).statusCode).toBe(400);
    expect((await request('GET', '/api/meals/suggestions?q=' + 'a'.repeat(201))).statusCode).toBe(400);
    expect((await week('9999-12-20')).days[6]!.date).toBe('9999-12-26');
  });
  it('rolls back ingredient replacement and the whole week copy on database failure', async () => {
    await put();
    await put('2026-10-20');
    const before = await week();
    database.sqlite.exec(
      `CREATE TRIGGER fail_ingredient BEFORE INSERT ON meal_ingredients BEGIN SELECT RAISE(ABORT, 'test'); END;`,
    );
    expect((await request('PUT', `/api/meals/${start}/dinner`, meal)).statusCode).toBe(500);
    expect(await week()).toEqual(before);
    database.sqlite.exec('DROP TRIGGER fail_ingredient');
    const beforeTarget = await week(target);
    database.sqlite.exec(
      `CREATE TRIGGER fail_second_meal BEFORE INSERT ON meals WHEN NEW.date = '2026-10-27' BEGIN SELECT RAISE(ABORT, 'test'); END;`,
    );
    expect((await copy(true)).statusCode).toBe(500);
    expect(await week(target)).toEqual(beforeTarget);
  });
  it('enforces unique slots and cascades, preserving meals when their creator is removed', async () => {
    const saved = await put(start, meal, member);
    expect(() =>
      database.db
        .insert(schema.meals)
        .values({ ...saved, id: randomUUID() })
        .run(),
    ).toThrow();
    database.db.delete(schema.users).where(eq(schema.users.id, member.id)).run();
    expect((await week()).days[0]!.meals[0]!.createdBy).toBeNull();
    database.db.delete(schema.families).where(eq(schema.families.id, familyId)).run();
    expect(database.db.select().from(schema.meals).all()).toEqual([]);
    expect(database.db.select().from(schema.mealIngredients).all()).toEqual([]);
  });
});
