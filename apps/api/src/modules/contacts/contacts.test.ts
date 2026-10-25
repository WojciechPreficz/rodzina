// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contactsResponseSchema, type Contact, type ContactGroup } from '@rodzina/shared';
import { buildApp } from '../../app.js';
import { hashToken } from '../../auth.js';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../db/client.js';
import * as schema from '../../db/schema.js';
import { createInitialContactGroups } from './repository.js';

describe('contacts API', () => {
  let database: ReturnType<typeof createDatabase>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let familyId: string;
  let admin: { id: string; cookie: string };
  let member: typeof admin;
  let child: typeof admin;
  let outsider: typeof admin;
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
  function request(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url = '/api/contacts',
    payload?: unknown,
    user = admin,
  ) {
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
  async function snapshot(user = admin) {
    const response = await request('GET', '/api/contacts', undefined, user);
    expect(response.statusCode, response.body).toBe(200);
    return contactsResponseSchema.parse(response.json());
  }
  async function add(fields = {}, user = admin): Promise<Contact> {
    const response = await request('POST', '/api/contacts', { name: 'Anna', ...fields }, user);
    expect(response.statusCode, response.body).toBe(201);
    return response.json().contact;
  }
  async function addGroup(user = admin): Promise<ContactGroup> {
    const response = await request('POST', '/api/contact-groups', { name: ' Lekarze ' }, user);
    expect(response.statusCode, response.body).toBe(201);
    return response.json().group;
  }
  beforeEach(async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      RODZINA_DATABASE_PATH: ':memory:',
      RODZINA_ALLOW_REGISTRATION: 'true',
    });
    database = createDatabase(config);
    migrate(database.db, { migrationsFolder: './apps/api/drizzle' });
    familyId = family();
    admin = actor(familyId, 'admin');
    member = actor(familyId, 'member');
    child = actor(familyId, 'child');
    const otherFamily = family();
    outsider = actor(otherFamily, 'admin');
    createInitialContactGroups(database, familyId, admin.id, 1);
    createInitialContactGroups(database, otherFamily, outsider.id, 1);
    app = await buildApp(config, database);
  });
  afterEach(async () => {
    await app?.close();
    database?.sqlite.close();
  });
  it('creates initial groups transactionally when a new family registers', async () => {
    const response = await request('POST', '/api/auth/register-family', {
      familyName: 'Nowa rodzina',
      displayName: 'Anna',
      email: 'anna@example.com',
      password: 'password123',
    });
    expect(response.statusCode, response.body).toBe(201);
    const groups = database.db
      .select()
      .from(schema.contactGroups)
      .where(eq(schema.contactGroups.familyId, response.json().family.id))
      .all();
    expect(groups.map((group) => group.name).sort()).toEqual(['Inne', 'Praca', 'Rodzina', 'Znajomi']);
    expect(groups.filter((group) => group.isDefault).map((group) => group.name)).toEqual(['Inne']);
    expect(groups.every((group) => group.createdBy === response.json().user.id)).toBe(true);
  });
  it('supports adult CRUD, null normalization, metadata and partial updates', async () => {
    const group = await addGroup(member);
    expect(group).toMatchObject({ familyId, name: 'Lekarze', isDefault: false, createdBy: member.id });
    const contact = await add(
      {
        name: ' Anna ',
        groupId: group.id,
        address: ' Ulica 1\nWarszawa ',
        phone: '+44 (20) 123-456',
        relationship: ' Mama ',
      },
      member,
    );
    expect(contact).toMatchObject({
      familyId,
      createdBy: member.id,
      name: 'Anna',
      address: 'Ulica 1\nWarszawa',
      relationship: 'Mama',
    });
    expect(contact.createdAt).toBeGreaterThan(0);
    const updated = await request('PATCH', `/api/contacts/${contact.id}`, { name: 'Ania', relationship: ' ' });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json().contact).toMatchObject({
      ...contact,
      name: 'Ania',
      relationship: null,
      updatedAt: expect.any(Number),
    });
    expect(updated.json().contact.updatedAt).toBeGreaterThanOrEqual(contact.updatedAt);
    const defaultGroup = (await snapshot()).groups.find((item) => item.isDefault)!;
    const moved = await request('PATCH', `/api/contacts/${contact.id}`, { groupId: defaultGroup.id });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json().contact).toMatchObject({ groupId: defaultGroup.id, name: 'Ania', phone: contact.phone });
    expect(
      (await request('PATCH', `/api/contacts/${contact.id}`, { phone: null, address: '' })).json().contact,
    ).toMatchObject({ phone: null, address: null, groupId: defaultGroup.id });
    expect(
      (await request('PATCH', `/api/contact-groups/${group.id}`, { name: ' Medycy ' })).json().group,
    ).toMatchObject({ ...group, name: 'Medycy', updatedAt: expect.any(Number) });
    expect((await request('DELETE', `/api/contacts/${contact.id}`, {}, member)).json()).toEqual({
      ok: true,
      deleted: true,
    });
    expect((await snapshot()).contacts).toEqual([]);
    expect((await request('DELETE', `/api/contacts/${contact.id}`)).statusCode).toBe(404);
    expect((await request('PATCH', `/api/contacts/${contact.id}`, { name: 'Brak' })).statusCode).toBe(404);
  });
  it('keeps the default identity after rename and moves contacts without changing other data', async () => {
    const initial = await snapshot();
    const defaultGroup = initial.groups.find((group) => group.isDefault)!;
    const group = await addGroup();
    const contacts = [await add({ groupId: group.id }), await add({ groupId: group.id, phone: '123' })];
    const other = await add();
    expect(other).toMatchObject({ groupId: defaultGroup.id, address: null, phone: null, relationship: null });
    expect((await request('PATCH', `/api/contact-groups/${defaultGroup.id}`, { name: 'Pozostałe' })).statusCode).toBe(
      200,
    );
    expect((await request('DELETE', `/api/contact-groups/${defaultGroup.id}`)).statusCode).toBe(409);
    expect((await request('DELETE', `/api/contact-groups/${group.id}`, {}, member)).statusCode).toBe(200);
    const after = await snapshot();
    expect(after.groups.some((item) => item.id === group.id)).toBe(false);
    expect(after.contacts).toHaveLength(3);
    for (const contact of contacts)
      expect(after.contacts.find((item) => item.id === contact.id)).toEqual({
        ...contact,
        groupId: defaultGroup.id,
        updatedAt: expect.any(Number),
      });
    expect(after.contacts.find((item) => item.id === other.id)).toEqual(other);
    expect((await request('DELETE', `/api/contact-groups/${group.id}`)).statusCode).toBe(404);
  });
  it('rolls back moved contacts if deleting the group fails', async () => {
    const group = await addGroup();
    await add({ groupId: group.id });
    const before = await snapshot();
    database.sqlite.exec(
      `CREATE TRIGGER fail_group_delete BEFORE DELETE ON contact_groups BEGIN SELECT RAISE(ABORT, 'test failure'); END;`,
    );
    expect((await request('DELETE', `/api/contact-groups/${group.id}`)).statusCode).toBe(500);
    expect(await snapshot()).toEqual(before);
    database.sqlite.exec('DROP TRIGGER fail_group_delete');
    database.sqlite.exec(
      `CREATE TRIGGER fail_contact_move BEFORE UPDATE ON contacts BEGIN SELECT RAISE(ABORT, 'test failure'); END;`,
    );
    expect((await request('DELETE', `/api/contact-groups/${group.id}`)).statusCode).toBe(500);
    expect(await snapshot()).toEqual(before);
  });
  it('allows child reads but rejects every mutation', async () => {
    const contact = await add();
    const group = await addGroup();
    const before = await snapshot();
    expect(await snapshot(child)).toEqual(before);
    for (const [method, url, payload] of [
      ['POST', '/api/contacts', { name: 'Nowy' }],
      ['PATCH', `/api/contacts/${contact.id}`, { name: 'Zmiana' }],
      ['DELETE', `/api/contacts/${contact.id}`, {}],
      ['POST', '/api/contact-groups', { name: 'Nowa' }],
      ['PATCH', `/api/contact-groups/${group.id}`, { name: 'Zmiana' }],
      ['DELETE', `/api/contact-groups/${group.id}`, {}],
    ] as const) {
      const response = await request(method, url, payload, child);
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN');
    }
    expect(await snapshot()).toEqual(before);
  });
  it('isolates snapshots and rejects foreign or missing contacts and groups', async () => {
    const contact = await add();
    const group = await addGroup();
    const foreignGroup = await addGroup(outsider);
    await add({}, outsider);
    const before = await snapshot();
    expect(before.contacts).toEqual([contact]);
    expect((await snapshot(outsider)).groups.every((row) => row.familyId !== familyId)).toBe(true);
    for (const id of [foreignGroup.id, randomUUID()]) {
      expect((await request('POST', '/api/contacts', { name: 'Nowy', groupId: id })).statusCode).toBe(404);
      expect((await request('PATCH', `/api/contacts/${contact.id}`, { groupId: id })).statusCode).toBe(404);
    }
    for (const [base, id] of [
      ['/api/contacts', contact.id],
      ['/api/contact-groups', group.id],
    ]) {
      for (const method of ['PATCH', 'DELETE'] as const) {
        expect((await request(method, `${base}/${id}`, { name: 'Atak' }, outsider)).statusCode).toBe(404);
        expect((await request(method, `${base}/${randomUUID()}`, { name: 'Brak' })).statusCode).toBe(404);
      }
    }
    expect(await snapshot()).toEqual(before);
    expect((await app.inject({ method: 'GET', url: '/api/contacts' })).statusCode).toBe(401);
  });
  it('validates inputs and prevents ownership or default flag injection', async () => {
    const contact = await add();
    const group = await addGroup();
    const before = await snapshot();
    for (const payload of [
      { name: ' ' },
      { name: 'a'.repeat(121) },
      { address: 'a'.repeat(1001) },
      { phone: 'a'.repeat(51) },
      { relationship: 'a'.repeat(121) },
      { groupId: null },
      { groupId: 'bad' },
      { familyId },
      { createdBy: outsider.id },
    ]) {
      expect((await request('PATCH', `/api/contacts/${contact.id}`, payload)).statusCode).toBe(400);
      expect((await request('POST', '/api/contacts', { name: 'Anna', ...payload })).statusCode).toBe(400);
    }
    expect((await request('PATCH', `/api/contacts/${contact.id}`, {})).statusCode).toBe(400);
    for (const payload of [
      {},
      { name: ' ' },
      { name: 'a'.repeat(61) },
      { name: 'Grupa', isDefault: true },
      { name: 'Grupa', familyId },
    ]) {
      expect((await request('POST', '/api/contact-groups', payload)).statusCode).toBe(400);
      expect((await request('PATCH', `/api/contact-groups/${group.id}`, payload)).statusCode).toBe(400);
    }
    expect(await snapshot()).toEqual(before);
  });
});
