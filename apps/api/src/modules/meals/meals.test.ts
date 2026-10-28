// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mealResponseSchema, mealWeekResponseSchema, mealsToShoppingListResponseSchema } from '@rodzina/shared';
import { createShoppingService } from '../shopping/service.js';
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
  function shopping() {
    return createShoppingService(database);
  }
  function list(user = admin) {
    return shopping().listLists(
      user === outsider
        ? database.db.select().from(schema.users).where(eq(schema.users.id, user.id)).get()!.familyId
        : familyId,
      user.id,
    )[0]!;
  }
  function exportMeals(listId: string, extra: Record<string, unknown> = {}, operationId = randomUUID(), user = admin) {
    return request(
      'POST',
      `/api/meals/to-shopping-list?operationId=${operationId}`,
      { weekStart: start, listId, ...extra },
      user,
    );
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

  it('groups normalized ingredients, merges current unpurchased items and preserves categories and history', async () => {
    const destination = list();
    const existing = shopping().createItem(familyId, destination.id, admin.id, {
      name: 'MARCHEW',
      quantity: '1 kg',
      category: 'fruit_vegetables',
    });
    const historyItem = shopping().createItem(familyId, destination.id, admin.id, { name: 'Mleko', category: 'dairy' });
    shopping().removeItem(familyId, historyItem.id, admin.id, 'admin');
    await put(start, {
      title: 'Zupa',
      ingredients: [{ name: 'marchew', quantity: '500 g' }, { name: 'Woda' }, { name: ' Mleko ', quantity: '1 l' }],
    });
    await put('2026-10-20', {
      title: 'Drugie',
      ingredients: [
        { name: 'ＭＡＲＣＨＥＷ', quantity: '2 szt' },
        { name: ' woda ', quantity: '1 l' },
      ],
    });
    const response = await exportMeals(destination.id, {}, randomUUID(), member);
    expect(response.statusCode, response.body).toBe(200);
    expect(mealsToShoppingListResponseSchema.parse(response.json())).toEqual({ ok: true, added: 2, updated: 1 });
    const items = shopping().listItems(familyId, destination.id);
    expect(items).toHaveLength(3);
    expect(items.find((item) => item.id === existing.id)).toMatchObject({
      quantity: '1 kg + 500 g + 2 szt',
      category: 'fruit_vegetables',
      createdBy: admin.id,
    });
    expect(items.find((item) => item.name === 'Woda')).toMatchObject({ quantity: '1 l', createdBy: member.id });
    expect(items.find((item) => item.name === 'Mleko')).toMatchObject({ quantity: '1 l', category: 'dairy' });
    expect(
      database.db
        .select()
        .from(schema.shoppingHistory)
        .all()
        .find((item) => item.nameNormalized === 'mleko')?.useCount,
    ).toBe(2);
  });

  it('leaves checked purchases untouched and adds a separate unpurchased need', async () => {
    const destination = list();
    const item = shopping().createItem(familyId, destination.id, admin.id, { name: 'Marchew', quantity: '2 kg' });
    const checked = shopping().updateItem(familyId, item.id, admin.id, 'admin', { isChecked: true });
    await put();
    expect((await exportMeals(destination.id)).json()).toEqual({ ok: true, added: 2, updated: 0 });
    const items = shopping().listItems(familyId, destination.id);
    expect(items.find((value) => value.id === checked.id)).toEqual(checked);
    expect(items.find((value) => value.name === 'Marchew' && !value.isChecked)).toMatchObject({
      quantity: '500 g',
      checkedBy: null,
      checkedAt: null,
    });
    expect((await exportMeals(destination.id, { confirmRepeat: true })).json()).toEqual({
      ok: true,
      added: 0,
      updated: 2,
    });
    expect(
      shopping()
        .listItems(familyId, destination.id)
        .find((value) => value.id === checked.id),
    ).toEqual(checked);
  });

  it('requires explicit confirmation for repeated meals and atomically rejects a mixed selection', async () => {
    const destination = list();
    const first = await put();
    const second = await put('2026-10-20');
    expect((await exportMeals(destination.id, { mealIds: [first.id] })).json()).toEqual({
      ok: true,
      added: 2,
      updated: 0,
    });
    const before = shopping().listItems(familyId, destination.id);
    const operation = randomUUID();
    const warning = await exportMeals(destination.id, {}, operation);
    expect(warning.statusCode).toBe(409);
    expect(warning.json()).toEqual({
      error: {
        code: 'MEAL_EXPORT_CONFIRMATION_REQUIRED',
        message: expect.stringContaining('ponownie dodać ich ilości'),
      },
    });
    expect(shopping().listItems(familyId, destination.id)).toEqual(before);
    expect(database.db.select().from(schema.mealShoppingExports).all()).toHaveLength(1);
    expect((await exportMeals(destination.id, { confirmRepeat: true }, operation)).json()).toEqual({
      ok: true,
      added: 0,
      updated: 2,
    });
    expect(
      shopping()
        .listItems(familyId, destination.id)
        .find((item) => item.name === 'Marchew')?.quantity,
    ).toBe('500 g + 500 g + 500 g');
    expect((await exportMeals(destination.id, { mealIds: [second.id] })).statusCode).toBe(409);
    const another = shopping().createList(familyId, admin.id, 'admin', { name: 'Druga' });
    expect((await exportMeals(another.id)).statusCode).toBe(200);
  });

  it('replays the same operation once, conflicts on changed payload and rechecks current access', async () => {
    const destination = list();
    await put();
    const operation = randomUUID();
    const results = await Promise.all([
      exportMeals(destination.id, {}, operation),
      exportMeals(destination.id, {}, operation),
    ]);
    expect(results.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(results[0]!.json()).toEqual(results[1]!.json());
    const before = shopping().listItems(familyId, destination.id);
    await app.close();
    app = await buildApp(loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' }), database);
    await put(start, { title: 'Zmiana', ingredients: [] });
    expect((await exportMeals(destination.id, {}, operation)).json()).toEqual(results[0]!.json());
    expect((await exportMeals(destination.id, { confirmRepeat: true }, operation)).statusCode).toBe(409);
    expect(shopping().listItems(familyId, destination.id)).toEqual(before);
    database.db.update(schema.users).set({ role: 'child' }).where(eq(schema.users.id, admin.id)).run();
    expect((await exportMeals(destination.id, {}, operation)).statusCode).toBe(403);
    database.db.update(schema.users).set({ role: 'admin' }).where(eq(schema.users.id, admin.id)).run();
    shopping().removeList(familyId, destination.id, 'admin');
    expect((await exportMeals(destination.id, {}, operation)).statusCode).toBe(404);
  });

  it('requires confirmation when different operations concurrently export the same meals', async () => {
    const destination = list();
    await put(start, {
      title: 'Duży obiad',
      ingredients: [
        { name: 'Mąka', quantity: 'x'.repeat(200) },
        { name: 'MĄKA', quantity: '500 g' },
        { name: 'Sól', quantity: null },
      ],
    });
    const results = await Promise.all([exportMeals(destination.id), exportMeals(destination.id)]);
    expect(results.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const items = shopping().listItems(familyId, destination.id);
    expect(items.find((item) => item.name === 'Mąka')?.quantity).toBe('x'.repeat(200) + ' + 500 g');
    expect(items.find((item) => item.name === 'Sól')?.quantity).toBeNull();
    const response = await request('GET', `/api/shopping/lists/${destination.id}/items`);
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual(items);
  });

  it('validates export selection, authentication, role and family without partial writes', async () => {
    const destination = list();
    const foreignList = list(outsider);
    const saved = await put();
    const foreignMeal = await put(start, meal, outsider);
    const otherWeek = await put(target);
    for (const id of [foreignMeal.id, otherWeek.id, randomUUID()]) {
      expect((await exportMeals(destination.id, { mealIds: [saved.id, id] })).statusCode).toBe(404);
    }
    expect((await exportMeals(foreignList.id)).statusCode).toBe(404);
    expect((await exportMeals(destination.id, {}, randomUUID(), outsider)).statusCode).toBe(404);
    expect((await exportMeals(destination.id, {}, randomUUID(), child)).statusCode).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/meals/to-shopping-list',
          payload: {},
          headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
        })
      ).statusCode,
    ).toBe(401);
    for (const extra of [
      { weekStart: '2026-10-20' },
      { listId: 'bad' },
      { mealIds: [] },
      { mealIds: ['bad'] },
      { mealIds: Array(8).fill(saved.id) },
      { confirmRepeat: 'true' },
      { familyId },
    ]) {
      expect((await exportMeals(destination.id, extra)).statusCode).toBe(400);
    }
    for (const suffix of ['', '?operationId=bad', `?operationId=${randomUUID()}&actorId=${outsider.id}`]) {
      expect(
        (await request('POST', '/api/meals/to-shopping-list' + suffix, { weekStart: start, listId: destination.id }))
          .statusCode,
      ).toBe(suffix.includes('actorId') ? 401 : 400);
    }
    expect(shopping().listItems(familyId, destination.id)).toEqual([]);
    expect((await exportMeals(destination.id, { mealIds: [saved.id, saved.id] })).json()).toEqual({
      ok: true,
      added: 2,
      updated: 0,
    });
  });

  it('keeps exported purchases independent of meal edits and deletion, including empty weeks', async () => {
    const destination = list();
    expect((await exportMeals(destination.id)).json()).toEqual({ ok: true, added: 0, updated: 0 });
    const saved = await put();
    await exportMeals(destination.id);
    const items = shopping().listItems(familyId, destination.id);
    shopping().updateItem(familyId, items[0]!.id, admin.id, 'admin', { name: 'Zakup zmieniony' });
    expect((await week()).days[0]!.meals[0]).toEqual(saved);
    const purchases = shopping().listItems(familyId, destination.id);
    await put(start, { title: 'Nowy', ingredients: [] });
    expect((await exportMeals(destination.id)).statusCode).toBe(409);
    await request('DELETE', `/api/meals/${start}/dinner`);
    expect(shopping().listItems(familyId, destination.id)).toEqual(purchases);
    expect(database.db.select().from(schema.mealShoppingExports).all()).toEqual([]);
  });

  it('rolls back purchases, history, receipts and idempotency together on failure and permits retry', async () => {
    const destination = list();
    shopping().createItem(familyId, destination.id, admin.id, { name: 'Marchew', quantity: '1 kg' });
    await put();
    const before = shopping().listItems(familyId, destination.id);
    const history = database.db.select().from(schema.shoppingHistory).all();
    database.sqlite.exec(
      "CREATE TRIGGER fail_export BEFORE INSERT ON meal_shopping_exports BEGIN SELECT RAISE(ABORT, 'test'); END;",
    );
    const operation = randomUUID();
    expect((await exportMeals(destination.id, {}, operation)).statusCode).toBe(500);
    expect(shopping().listItems(familyId, destination.id)).toEqual(before);
    expect(database.db.select().from(schema.shoppingHistory).all()).toEqual(history);
    expect(database.db.select().from(schema.mealShoppingExports).all()).toEqual([]);
    expect(database.db.select().from(schema.shoppingOperations).all()).toEqual([]);
    database.sqlite.exec('DROP TRIGGER fail_export');
    expect((await exportMeals(destination.id, {}, operation)).json()).toEqual({ ok: true, added: 1, updated: 1 });
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
