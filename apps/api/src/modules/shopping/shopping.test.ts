// @vitest-environment node
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShoppingItem, ShoppingList } from '@rodzina/shared';
import { buildApp } from '../../app.js';
import { hashToken } from '../../auth.js';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../db/client.js';
import * as schema from '../../db/schema.js';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');
const base = '/api/shopping';

describe('shopping API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let database: ReturnType<typeof createDatabase>;
  let familyId: string;
  let admin: { id: string; cookie: string };
  let member: typeof admin;
  let child: typeof admin;
  let otherChild: typeof admin;
  let outsider: typeof admin;

  function family() {
    const id = crypto.randomUUID();
    database.db.insert(schema.families).values({ id, name: 'Rodzina', joinCode: id, createdAt: Date.now() }).run();
    return id;
  }
  function actor(familyId: string, role: 'admin' | 'member' | 'child') {
    const id = crypto.randomUUID();
    const token = crypto.randomUUID();
    database.db
      .insert(schema.users)
      .values({ id, familyId, displayName: role, role, createdAt: Date.now(), updatedAt: Date.now() })
      .run();
    database.db
      .insert(schema.sessions)
      .values({ id: hashToken(token), userId: id, expiresAt: Date.now() + 86400000, createdAt: Date.now() })
      .run();
    return { id, cookie: `sid=${token}` };
  }
  function request(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown, user = admin) {
    return app.inject({
      method,
      url,
      headers: {
        cookie: user.cookie,
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      ...(method === 'GET' ? {} : { payload: JSON.stringify(payload ?? {}) }),
    });
  }
  async function list(user = admin): Promise<ShoppingList> {
    const response = await request('GET', `${base}/lists`, undefined, user);
    expect(response.statusCode, response.body).toBe(200);
    return response.json().lists[0];
  }
  async function add(
    listId: string,
    data: Record<string, unknown> = { name: 'Mleko' },
    user = admin,
  ): Promise<ShoppingItem> {
    const response = await request('POST', `${base}/lists/${listId}/items`, data, user);
    expect(response.statusCode, response.body).toBe(201);
    return response.json().item;
  }
  beforeEach(async () => {
    const config = loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' });
    database = createDatabase(config);
    migrate(database.db, { migrationsFolder });
    app = await buildApp(config, database);
    familyId = family();
    admin = actor(familyId, 'admin');
    member = actor(familyId, 'member');
    child = actor(familyId, 'child');
    otherChild = actor(familyId, 'child');
    outsider = actor(family(), 'admin');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app?.close();
    database?.sqlite.close();
  });

  it('creates one shared default list even when a child enters first or requests overlap', async () => {
    const results = await Promise.all([list(child), list(member), list(admin)]);
    expect(new Set(results.map((row) => row.id)).size).toBe(1);
    expect(results[0]).toMatchObject({ familyId, name: 'Zakupy', position: 0, createdBy: child.id });
    expect(database.db.select().from(schema.shoppingLists).all()).toHaveLength(1);
  });

  it('supports named lists, partial edits, ordering and cascading deletion for adults', async () => {
    const first = await list();
    const created = await request('POST', `${base}/lists`, { name: '  Drogeria  ' }, member);
    expect(created.statusCode).toBe(201);
    const second = created.json().list;
    expect(second).toMatchObject({ name: 'Drogeria', position: 1, createdBy: member.id });
    const patched = await request('PATCH', `${base}/lists/${first.id}`, { name: 'Lidl', position: 5 }, member);
    expect(patched.json().list).toMatchObject({
      name: 'Lidl',
      position: 5,
      createdAt: first.createdAt,
      createdBy: admin.id,
    });
    expect((await request('GET', `${base}/lists`)).json().lists.map((row: ShoppingList) => row.name)).toEqual([
      'Drogeria',
      'Lidl',
    ]);
    await add(first.id);
    expect((await request('DELETE', `${base}/lists/${first.id}`, undefined, member)).statusCode).toBe(200);
    expect((await request('GET', `${base}/lists/${first.id}/items`)).statusCode).toBe(404);
    expect(database.db.select().from(schema.shoppingItems).all()).toEqual([]);
    expect(database.db.select().from(schema.shoppingHistory).all()).toHaveLength(1);
    expect((await list()).id).toBe(second.id);
    await request('DELETE', `${base}/lists/${second.id}`);
    expect((await list()).name).toBe('Zakupy');
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('supports item CRUD, null quantities, positions and last-write-wins partial updates', async () => {
    const { id } = await list();
    const first = await add(id, { name: '  Mleko  ', quantity: '  2 l ', category: 'dairy' });
    expect(first).toMatchObject({
      name: 'Mleko',
      quantity: '2 l',
      category: 'dairy',
      position: 0,
      isChecked: false,
      checkedBy: null,
      checkedAt: null,
      createdBy: admin.id,
    });
    const second = await add(id, { name: 'Chleb' }, child);
    expect(second).toMatchObject({ quantity: null, category: 'other', position: 1 });
    const patched = await request(
      'PATCH',
      `${base}/items/${first.id}`,
      { name: 'Kefir', quantity: null, category: 'drinks', position: 3 },
      member,
    );
    expect(patched.statusCode).toBe(200);
    expect(patched.json().item).toMatchObject({
      name: 'Kefir',
      quantity: null,
      category: 'drinks',
      position: 3,
      createdAt: first.createdAt,
      createdBy: admin.id,
    });
    await request('PATCH', `${base}/items/${first.id}`, { name: 'Jogurt' });
    await request('PATCH', `${base}/items/${first.id}`, { name: 'Maślanka' }, member);
    const items = (await request('GET', `${base}/lists/${id}/items`, undefined, child)).json().items;
    expect(items.map((row: ShoppingItem) => row.id)).toEqual([second.id, first.id]);
    expect(items[1]).toMatchObject({ name: 'Maślanka', position: 3, category: 'drinks' });
    expect((await request('DELETE', `${base}/items/${first.id}`, undefined, member)).statusCode).toBe(200);
    expect((await request('PATCH', `${base}/items/${first.id}`, { name: 'Brak' })).statusCode).toBe(404);
    expect((await request('DELETE', `${base}/items/${first.id}`)).statusCode).toBe(404);
    const blank = await add(id, { name: 'Ryż', quantity: '  ' });
    expect(blank.quantity).toBeNull();
  });

  it('records who checked an item, keeps retries idempotent and clears metadata when unchecked', async () => {
    const { id } = await list();
    const item = await add(id);
    const second = await add(id, { name: 'Chleb' });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000);
    const checked = (await request('PATCH', `${base}/items/${item.id}`, { isChecked: true }, child)).json().item;
    expect(checked).toMatchObject({ isChecked: true, checkedBy: child.id, checkedAt: Date.now() });
    expect((await request('GET', `${base}/lists/${id}/items`)).json().items.map((row: ShoppingItem) => row.id)).toEqual(
      [second.id, item.id],
    );
    vi.mocked(Date.now).mockReturnValue(Date.now() + 1000);
    const retried = (await request('PATCH', `${base}/items/${item.id}`, { isChecked: true }, member)).json().item;
    expect(retried).toMatchObject({ checkedBy: child.id, checkedAt: checked.checkedAt });
    const unchecked = await request('PATCH', `${base}/items/${item.id}`, { isChecked: false }, otherChild);
    expect(unchecked.json().item).toMatchObject({ isChecked: false, checkedBy: null, checkedAt: null });
  });

  it('allows children to manage only their own items and rejects mixed checkbox/edit requests atomically', async () => {
    const { id } = await list();
    const adultItem = await add(id);
    const own = await add(id, { name: 'Jabłka' }, child);
    const sibling = await add(id, { name: 'Sok' }, otherChild);
    expect(
      (
        await request(
          'PATCH',
          `${base}/items/${own.id}`,
          { name: 'Gruszki', quantity: '2', category: 'fruit_vegetables', position: 5 },
          child,
        )
      ).statusCode,
    ).toBe(200);
    for (const foreign of [adultItem, sibling]) {
      for (const data of [
        { name: 'Zmiana' },
        { quantity: '3' },
        { category: 'other' },
        { position: 7 },
        { isChecked: true, name: 'Zmiana' },
      ]) {
        expect((await request('PATCH', `${base}/items/${foreign.id}`, data, child)).statusCode).toBe(403);
      }
      expect((await request('DELETE', `${base}/items/${foreign.id}`, undefined, child)).statusCode).toBe(403);
      expect(
        database.db.select().from(schema.shoppingItems).where(eq(schema.shoppingItems.id, foreign.id)).get(),
      ).toEqual(foreign);
    }
    expect((await request('DELETE', `${base}/items/${own.id}`, undefined, child)).statusCode).toBe(200);
    expect((await request('PATCH', `${base}/items/${sibling.id}`, { name: 'Sok jabłkowy' }, member)).statusCode).toBe(
      200,
    );
    expect((await request('DELETE', `${base}/items/${sibling.id}`)).statusCode).toBe(200);
  });

  it('denies list management and clearing to children', async () => {
    const { id } = await list();
    for (const [method, url, payload] of [
      ['POST', `${base}/lists`, { name: 'Nowa' }],
      ['PATCH', `${base}/lists/${id}`, { name: 'Nowa' }],
      ['PATCH', `${base}/lists/${id}`, { position: 4 }],
      ['DELETE', `${base}/lists/${id}`, {}],
      ['POST', `${base}/lists/${id}/clear-checked`, {}],
    ] as const) {
      const response = await request(method, url, payload, child);
      expect(response.statusCode, response.body).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN');
    }
  });

  it('clears only checked items from the selected list and preserves history', async () => {
    const first = await list();
    const second = (await request('POST', `${base}/lists`, { name: 'Druga' })).json().list;
    const checked = await add(first.id);
    const open = await add(first.id, { name: 'Chleb' });
    const other = await add(second.id, { name: 'Ser' });
    for (const item of [checked, other]) await request('PATCH', `${base}/items/${item.id}`, { isChecked: true });
    const cleared = await request('POST', `${base}/lists/${first.id}/clear-checked`, {}, member);
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toEqual({ ok: true, deletedCount: 1 });
    expect((await request('GET', `${base}/lists/${first.id}/items`)).json().items).toEqual([open]);
    expect((await request('GET', `${base}/lists/${second.id}/items`)).json().items).toHaveLength(1);
    expect(database.db.select().from(schema.shoppingHistory).all()).toHaveLength(3);
    expect((await request('POST', `${base}/lists/${first.id}/clear-checked`)).json().deletedCount).toBe(0);
  });

  it('isolates every list/item operation and suggestion by family, returning 404 for foreign or missing IDs', async () => {
    const own = await list();
    const item = await add(own.id);
    const foreign = await list(outsider);
    await add(foreign.id, { name: 'Sekret' }, outsider);
    for (const user of [outsider, actor(foreign.familyId, 'child')]) {
      expect(
        (await request('GET', `${base}/lists`, undefined, user)).json().lists.map((row: ShoppingList) => row.id),
      ).toEqual([foreign.id]);
      expect((await request('GET', `${base}/suggestions?q=Ml`, undefined, user)).json().suggestions).toEqual([]);
      for (const listId of [own.id, crypto.randomUUID()]) {
        for (const [method, url, payload] of [
          ['GET', `${base}/lists/${listId}/items`, undefined],
          ['POST', `${base}/lists/${listId}/items`, { name: 'Próba' }],
          ['PATCH', `${base}/lists/${listId}`, { name: 'Próba' }],
          ['DELETE', `${base}/lists/${listId}`, {}],
          ['POST', `${base}/lists/${listId}/clear-checked`, {}],
        ] as const)
          expect((await request(method, url, payload, user)).statusCode).toBe(404);
      }
      for (const itemId of [item.id, crypto.randomUUID()]) {
        expect((await request('PATCH', `${base}/items/${itemId}`, { isChecked: true }, user)).statusCode).toBe(404);
        expect((await request('DELETE', `${base}/items/${itemId}`, {}, user)).statusCode).toBe(404);
      }
    }
    expect(database.db.select().from(schema.shoppingItems).where(eq(schema.shoppingItems.id, item.id)).get()).toEqual(
      item,
    );
  });

  it('normalizes history, increments on additions only and infers or explicitly replaces the category', async () => {
    const { id } = await list();
    const first = await add(id, { name: '  MLEKO   UHT  ', category: 'dairy' });
    const second = await add(id, { name: 'mleko uht' }, child);
    expect(second.category).toBe('dairy');
    await add(id, { name: 'ＭＬＥＫＯ UHT', category: 'drinks' });
    expect((await add(id, { name: 'Mleko UHT' })).category).toBe('drinks');
    await request('PATCH', `${base}/items/${first.id}`, { name: 'Inny produkt', isChecked: true });
    await request('DELETE', `${base}/items/${second.id}`);
    const history = database.db.select().from(schema.shoppingHistory).all();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      familyId,
      nameNormalized: 'mleko uht',
      displayName: 'Mleko UHT',
      useCount: 4,
      category: 'drinks',
    });
    expect((await request('GET', `${base}/suggestions?q=%20mLeKo%20`, undefined, child)).json().suggestions).toEqual([
      { name: 'Mleko UHT', category: 'drinks' },
    ]);
    expect((await request('GET', `${base}/suggestions?q=UHT`)).json().suggestions).toEqual([]);
  });

  it('limits suggestions to eight and sorts by use count then recency', async () => {
    const { id } = await list();
    const start = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(start);
    for (let i = 0; i < 10; i++) {
      vi.mocked(Date.now).mockReturnValue(start + i);
      await add(id, { name: `Produkt ${i}` });
    }
    vi.mocked(Date.now).mockReturnValue(start + 20);
    await add(id, { name: 'Produkt 0' });
    vi.mocked(Date.now).mockReturnValue(start + 21);
    await add(id, { name: 'Produkt 1' });
    const response = await request('GET', `${base}/suggestions?q=prod`);
    expect(response.statusCode).toBe(200);
    expect(response.json().suggestions.map((row: { name: string }) => row.name)).toEqual([
      'Produkt 1',
      'Produkt 0',
      'Produkt 9',
      'Produkt 8',
      'Produkt 7',
      'Produkt 6',
      'Produkt 5',
      'Produkt 4',
    ]);
  });

  it('treats SQL wildcard characters literally in suggestions', async () => {
    const { id } = await list();
    await add(id, { name: '100% sok' });
    await add(id, { name: '_produkt' });
    for (const q of ['%', "' OR 1=1 --"])
      expect((await request('GET', `${base}/suggestions?q=${encodeURIComponent(q)}`)).json().suggestions).toEqual([]);
    expect((await request('GET', `${base}/suggestions?q=_`)).json().suggestions).toEqual([
      { name: '_produkt', category: 'other' },
    ]);
  });

  it('rolls back the item if recording its history fails', async () => {
    const { id } = await list();
    database.sqlite.exec(
      "CREATE TRIGGER fail_history BEFORE INSERT ON shopping_history BEGIN SELECT RAISE(ABORT, 'history unavailable'); END",
    );
    const response = await request('POST', `${base}/lists/${id}/items`, { name: 'Mleko' });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Nie udało się obsłużyć zakupów.' } });
    expect(database.db.select().from(schema.shoppingItems).all()).toEqual([]);
    expect(database.db.select().from(schema.shoppingHistory).all()).toEqual([]);
  });

  it('keeps history categories and counts separate for identical product names in different families', async () => {
    const own = await list();
    const foreign = await list(outsider);
    await add(own.id, { name: 'Mleko', category: 'dairy' });
    await add(own.id, { name: 'Mleko' });
    await add(foreign.id, { name: 'Mleko', category: 'drinks' }, outsider);
    expect((await request('GET', `${base}/suggestions?q=ml`)).json().suggestions).toEqual([
      { name: 'Mleko', category: 'dairy' },
    ]);
    expect((await request('GET', `${base}/suggestions?q=ml`, undefined, outsider)).json().suggestions).toEqual([
      { name: 'Mleko', category: 'drinks' },
    ]);
    expect(
      database.db.select().from(schema.shoppingHistory).where(eq(schema.shoppingHistory.familyId, familyId)).get()
        ?.useCount,
    ).toBe(2);
    expect(
      database.db
        .select()
        .from(schema.shoppingHistory)
        .where(eq(schema.shoppingHistory.familyId, foreign.familyId))
        .get()?.useCount,
    ).toBe(1);
  });

  it('can add lists and items after reordering existing rows to the maximum position', async () => {
    const own = await list();
    const first = await add(own.id);
    await request('PATCH', `${base}/lists/${own.id}`, { position: 2147483647 });
    await request('PATCH', `${base}/items/${first.id}`, { position: 2147483647 });
    expect((await request('POST', `${base}/lists`, { name: 'Nowa' })).statusCode).toBe(201);
    expect((await add(own.id, { name: 'Chleb' })).position).toBe(2147483647);
  });

  it('validates payloads and never lets clients set identity, author or check metadata', async () => {
    const { id } = await list();
    const item = await add(id);
    for (const payload of [
      {},
      { name: ' ' },
      { name: 'a'.repeat(201) },
      { name: 'Nowa', familyId },
      { name: 'Nowa', createdBy: child.id },
    ])
      expect((await request('POST', `${base}/lists`, payload)).statusCode).toBe(400);
    for (const payload of [{}, { name: ' ' }, { position: -1 }, { position: 1.5 }, { position: '1' }, { familyId }])
      expect((await request('PATCH', `${base}/lists/${id}`, payload)).statusCode).toBe(400);
    for (const payload of [
      {},
      { name: ' ' },
      { name: 'Sok', quantity: 2 },
      { name: 'Sok', category: 'invalid' },
      { name: 'Sok', createdBy: child.id },
      { name: 'Sok', listId: id },
      { name: 'Sok', isChecked: true },
    ])
      expect((await request('POST', `${base}/lists/${id}/items`, payload)).statusCode).toBe(400);
    for (const payload of [
      {},
      { name: '' },
      { isChecked: 'true' },
      { position: -1 },
      { checkedBy: child.id },
      { checkedAt: 5 },
      { listId: id },
      { familyId },
      { createdBy: child.id },
    ])
      expect((await request('PATCH', `${base}/items/${item.id}`, payload)).statusCode).toBe(400);
    for (const query of ['', '?q=', '?q=%20', '?q=test&familyId=other'])
      expect((await request('GET', `${base}/suggestions${query}`)).statusCode).toBe(400);
    expect((await request('GET', `${base}/lists/not-a-uuid/items`)).statusCode).toBe(400);
    expect(database.db.select().from(schema.shoppingItems).all()).toEqual([item]);
    expect(database.db.select().from(schema.shoppingHistory).all()[0]?.useCount).toBe(1);
  });

  it('requires a session for every endpoint and retains CSRF protection', async () => {
    const { id } = await list();
    const item = await add(id);
    for (const [method, url] of [
      ['GET', `${base}/lists`],
      ['POST', `${base}/lists`],
      ['PATCH', `${base}/lists/${id}`],
      ['DELETE', `${base}/lists/${id}`],
      ['GET', `${base}/lists/${id}/items`],
      ['POST', `${base}/lists/${id}/items`],
      ['PATCH', `${base}/items/${item.id}`],
      ['DELETE', `${base}/items/${item.id}`],
      ['POST', `${base}/lists/${id}/clear-checked`],
      ['GET', `${base}/suggestions?q=ml`],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: { origin: 'http://localhost:3000', host: 'localhost:3000', 'content-type': 'application/json' },
        ...(method === 'GET' ? {} : { payload: '{}' }),
      });
      expect(response.statusCode, response.body).toBe(401);
    }
    const csrf = await app.inject({
      method: 'POST',
      url: `${base}/lists`,
      headers: {
        cookie: admin.cookie,
        origin: 'https://foreign.example',
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      payload: JSON.stringify({ name: 'Obca' }),
    });
    expect(csrf.statusCode).toBe(403);
  });

  it('preserves shopping data with null attribution after a member is removed', async () => {
    const own = await list(member);
    const item = await add(own.id, { name: 'Mleko' }, member);
    await request('PATCH', `${base}/items/${item.id}`, { isChecked: true }, member);
    expect((await request('DELETE', `/api/members/${member.id}`)).statusCode).toBe(200);
    expect((await list()).createdBy).toBeNull();
    const row = (await request('GET', `${base}/lists/${own.id}/items`)).json().items[0];
    expect(row).toMatchObject({ id: item.id, createdBy: null, checkedBy: null, isChecked: true });
    expect(row.checkedAt).toEqual(expect.any(Number));
    expect((await request('PATCH', `${base}/items/${item.id}`, { name: 'Zmiana' }, child)).statusCode).toBe(403);
    expect((await request('PATCH', `${base}/items/${item.id}`, { name: 'Mleko UHT' })).statusCode).toBe(200);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  });
});
