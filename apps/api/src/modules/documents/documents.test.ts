// @vitest-environment node
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCUMENT_TYPES, documentsResponseSchema, type FamilyDocument } from '@rodzina/shared';
import { buildApp } from '../../app.js';
import { hashToken } from '../../auth.js';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../db/client.js';
import * as schema from '../../db/schema.js';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');
describe('documents API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let database: ReturnType<typeof createDatabase>;
  let familyId: string;
  let admin: { id: string; cookie: string };
  let member: typeof admin;
  let child: typeof admin;
  let outsider: typeof admin;
  const data = { type: 'passport', label: 'Paszport', expiresOn: '2028-05-01' };
  function family() {
    const id = crypto.randomUUID();
    database.db.insert(schema.families).values({ id, name: 'Rodzina', joinCode: id, createdAt: 1 }).run();
    return id;
  }
  function actor(familyId: string, role: 'admin' | 'member' | 'child') {
    const id = crypto.randomUUID();
    const token = crypto.randomUUID();
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
    url = '/api/documents',
    payload?: unknown,
    user = admin,
  ) {
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
  async function add(fields = {}, user = admin): Promise<FamilyDocument> {
    const response = await request('POST', '/api/documents', { ...data, ...fields }, user);
    expect(response.statusCode, response.body).toBe(201);
    return response.json().document;
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
    outsider = actor(family(), 'admin');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await app?.close();
    database?.sqlite.close();
  });
  it('supports all types, shared adult edits, sorting and deletion', async () => {
    for (const type of DOCUMENT_TYPES)
      await add({ type, ...(type.startsWith('car_') ? { vehicleLabel: 'Skoda' } : {}) });
    const earliest = await add({ expiresOn: '2027-01-01', holderUserId: child.id, notes: ' Notatka ' }, member);
    expect(earliest).toMatchObject({ familyId, createdBy: member.id, notes: 'Notatka', holderUserId: child.id });
    expect(earliest.createdAt).toBeGreaterThan(0);
    const listed = documentsResponseSchema.parse((await request('GET')).json()).documents;
    expect(listed).toHaveLength(DOCUMENT_TYPES.length + 1);
    expect(listed[0]!.id).toBe(earliest.id);
    const response = await request('PATCH', `/api/documents/${earliest.id}`, {
      label: 'Nowy paszport',
      expiresOn: '2029-01-01',
      notes: null,
      holderUserId: null,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().document).toMatchObject({
      label: 'Nowy paszport',
      expiresOn: '2029-01-01',
      notes: null,
      holderUserId: null,
      createdBy: member.id,
      createdAt: earliest.createdAt,
    });
    expect(response.json().document.updatedAt).toBeGreaterThanOrEqual(earliest.updatedAt);
    expect(database.db.select().from(schema.reminders).all().length).toBeGreaterThan(0);
    expect((await request('DELETE', `/api/documents/${earliest.id}`, undefined, member)).json()).toEqual({
      ok: true,
      deleted: true,
    });
    expect((await request('PATCH', `/api/documents/${earliest.id}`, { label: 'Brak' })).statusCode).toBe(404);
    expect((await request('DELETE', `/api/documents/${earliest.id}`)).statusCode).toBe(404);
  });
  it('allows children to read all documents but never write', async () => {
    const document = await add();
    expect((await request('GET', '/api/documents', undefined, child)).json().documents).toHaveLength(1);
    for (const [method, url, payload] of [
      ['POST', '/api/documents', data],
      ['PATCH', `/api/documents/${document.id}`, { notes: 'Zmiana' }],
      ['DELETE', `/api/documents/${document.id}`, {}],
    ] as const) {
      const response = await request(method, url, payload, child);
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('FORBIDDEN');
    }
    expect((await request('GET')).json().documents).toEqual([document]);
  });
  it('isolates families and rejects foreign and missing holders on create and update', async () => {
    const document = await add();
    await add({ label: 'Obcy dokument' }, outsider);
    expect((await request('GET')).json().documents.map((row: FamilyDocument) => row.id)).toEqual([document.id]);
    expect((await request('GET', '/api/documents', undefined, outsider)).json().documents).toHaveLength(1);
    for (const method of ['PATCH', 'DELETE'] as const)
      expect((await request(method, `/api/documents/${document.id}`, { label: 'Atak' }, outsider)).statusCode).toBe(
        404,
      );
    for (const holderUserId of [outsider.id, crypto.randomUUID()]) {
      expect((await request('POST', '/api/documents', { ...data, holderUserId })).statusCode).toBe(400);
      expect((await request('PATCH', `/api/documents/${document.id}`, { holderUserId })).statusCode).toBe(400);
    }
    expect((await request('GET')).json().documents).toEqual([document]);
  });
  it('validates fields, type changes and partial updates against the resulting document', async () => {
    const document = await add({ holderUserId: child.id });
    for (const payload of [
      {},
      { expiresOn: '2027-02-29' },
      { type: 'unknown' },
      { label: '' },
      { number: '123' },
      { familyId },
      { vehicleLabel: 'Skoda' },
      { type: 'car_insurance' },
    ])
      expect((await request('PATCH', `/api/documents/${document.id}`, payload)).statusCode).toBe(400);
    for (const payload of [
      { ...data, vehicleLabel: 'Skoda' },
      { ...data, type: 'other', holderUserId: child.id },
      { ...data, number: '123' },
      { ...data, expiresOn: '2028-04-31' },
    ])
      expect((await request('POST', '/api/documents', payload)).statusCode).toBe(400);
    const response = await request('PATCH', `/api/documents/${document.id}`, {
      type: 'car_insurance',
      holderUserId: null,
      vehicleLabel: 'Skoda',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().document).toMatchObject({
      type: 'car_insurance',
      holderUserId: null,
      vehicleLabel: 'Skoda',
    });
    expect((await request('PATCH', '/api/documents/not-a-uuid', { label: 'X' })).statusCode).toBe(400);
    expect((await request('DELETE', '/api/documents/not-a-uuid')).statusCode).toBe(400);
  });
  it('computes statuses using the family date including local midnight and expiry day', async () => {
    await add({ expiresOn: '2028-05-01' });
    database.db
      .update(schema.sessions)
      .set({ expiresAt: Date.parse('2029-01-01T00:00:00Z') })
      .run();
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2028-05-01T21:59:59Z'));
    expect((await request('GET')).json().documents[0].status).toBe('expiring');
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2028-05-01T22:00:00Z'));
    expect((await request('GET')).json().documents[0].status).toBe('expired');
  });
  it('requires authentication and trusted mutation origins', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/documents' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/documents',
          payload: data,
          headers: { cookie: admin.cookie, host: 'localhost:3000', origin: 'https://foreign.example' },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('preserves documents with null references after a member is removed and cascades family removal', async () => {
    const document = await add({ holderUserId: member.id }, member);
    database.db.delete(schema.users).where(eq(schema.users.id, member.id)).run();
    expect((await request('GET')).json().documents[0]).toMatchObject({
      id: document.id,
      holderUserId: null,
      createdBy: null,
    });
    database.db.delete(schema.families).where(eq(schema.families.id, familyId)).run();
    expect(database.db.select().from(schema.documents).all()).toEqual([]);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  });
});
