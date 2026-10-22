// @vitest-environment node
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DOCUMENT_TYPES,
  getDefaultDocumentReminders,
  localDateTimeToUtc,
  reminderScheduleSchema,
  type FamilyDocument,
} from '@rodzina/shared';
import { resolveRecipients } from '../reminders/delivery.js';
import { readReminderSchedule } from '../reminders/schedule.js';
import { buildApp } from '../../app.js';
import { hashToken } from '../../auth.js';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../db/client.js';
import * as schema from '../../db/schema.js';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');
describe('document reminders', () => {
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
      .values({
        id: hashToken(token),
        userId: id,
        expiresAt: Date.parse('2029-01-01T00:00:00Z'),
        createdAt: Date.now(),
      })
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
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-01T00:00:00Z'));
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
  const offset = { type: 'offset', offsetValue: 30, offsetUnit: 'day' } as const;
  const utc = (date: string) => localDateTimeToUtc(date, '09:00', 'Europe/Warsaw');
  const stored = (id: string) =>
    database.db.select().from(schema.reminders).where(eq(schema.reminders.documentId, id)).all();
  async function schedule(user = admin, query = '?includeDocuments=true') {
    const response = await request('GET', `/api/reminders/schedule${query}`, undefined, user);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    return reminderScheduleSchema.parse(response.json()).reminders;
  }
  async function mine(documentId: string, user = child, fields = {}) {
    const response = await request('POST', '/api/reminders/mine', { documentId, ...offset, ...fields }, user);
    expect(response.statusCode, response.body).toBe(200);
    return response.json().reminder;
  }
  it.each(DOCUMENT_TYPES)('sets default reminders for %s only when omitted', async (type) => {
    const document = await add({ type, expiresOn: '2026-12-31' });
    const defaults = getDefaultDocumentReminders(type);
    expect(document.reminders).toHaveLength(defaults.length);
    for (const reminder of document.reminders) {
      expect(defaults).toContainEqual({
        type: reminder.type,
        offsetValue: reminder.offsetValue,
        offsetUnit: reminder.offsetUnit,
        audience: reminder.audience,
      });
      expect(reminder).toMatchObject({ documentId: document.id, eventId: null, taskId: null, userId: null });
    }
    expect((await add({ type, reminders: [] })).reminders).toEqual([]);
    expect((await add({ type, reminders: [offset] })).reminders).toEqual([
      expect.objectContaining({ ...offset, audience: 'adults' }),
    ]);
  });
  it('renews and patches shared and personal offsets while keeping absolute dates and ownership', async () => {
    const absolute = { type: 'absolute', remindAt: utc('2026-10-20'), audience: 'family' };
    const document = await add({ expiresOn: '2026-11-15', reminders: [offset, absolute] });
    const personal = await mine(document.id);
    expect(document.reminders.find((r) => r.type === 'offset')!.nextFireAt).toBe(utc('2026-10-16'));
    vi.spyOn(Date, 'now').mockReturnValue(utc('2026-10-21'));
    const renewed = await request('POST', `/api/documents/${document.id}/renew`, { expiresOn: '2026-12-15' }, member);
    expect(renewed.statusCode, renewed.body).toBe(200);
    expect(stored(document.id)).toHaveLength(3);
    expect(
      stored(document.id)
        .filter((r) => r.type === 'offset')
        .every((r) => r.nextFireAt === utc('2026-11-15')),
    ).toBe(true);
    expect(stored(document.id).find((r) => r.type === 'absolute')).toMatchObject({
      nextFireAt: null,
      remindAt: absolute.remindAt,
    });
    expect(stored(document.id).find((r) => r.id === personal.id)).toMatchObject({
      userId: child.id,
      createdBy: child.id,
    });
    await request('PATCH', `/api/documents/${document.id}`, { expiresOn: '2026-12-20', reminders: [] });
    expect(stored(document.id)).toEqual([expect.objectContaining({ id: personal.id, nextFireAt: utc('2026-11-20') })]);
    expect((await request('GET', '/api/documents')).json().documents[0].reminders).toEqual([]);
    expect(
      (await request('GET', `/api/reminders/mine?documentId=${document.id}`, undefined, child)).json().reminders,
    ).toHaveLength(1);
    expect(await schedule()).toEqual([]);
    expect((await schedule(child))[0]?.fireAt).toBe(utc('2026-11-20'));
  });
  it('keeps a future absolute reminder fixed after renewal and excludes elapsed and out-of-window alarms', async () => {
    const document = await add({
      expiresOn: '2026-11-15',
      reminders: [{ type: 'absolute', remindAt: utc('2026-10-20') }],
    });
    await request('POST', `/api/documents/${document.id}/renew`, { expiresOn: '2028-01-01' });
    expect((await schedule())[0]?.fireAt).toBe(utc('2026-10-20'));
    vi.spyOn(Date, 'now').mockReturnValue(utc('2026-10-20'));
    expect(await schedule()).toEqual([]);
    await request('PATCH', `/api/documents/${document.id}`, { reminders: [offset] });
    expect(await schedule()).toEqual([]);
  });
  it('resolves adults, family, holder, creator fallback and personal recipients without crossing families', async () => {
    const document = await add({ expiresOn: '2026-11-15', holderUserId: child.id, reminders: [offset] });
    expect(await schedule(admin)).toHaveLength(1);
    expect(await schedule(member)).toHaveLength(1);
    expect(await schedule(child)).toEqual([]);
    expect(await schedule(outsider)).toEqual([]);
    await request('PATCH', `/api/documents/${document.id}`, { reminders: [{ ...offset, audience: 'family' }] });
    expect(await schedule(child)).toHaveLength(1);
    await request('PATCH', `/api/documents/${document.id}`, { reminders: [{ ...offset, audience: 'owner' }] });
    expect(await schedule(child)).toHaveLength(1);
    expect(await schedule(admin)).toEqual([]);
    await request('PATCH', `/api/documents/${document.id}`, { holderUserId: null });
    expect(await schedule(admin)).toHaveLength(1);
    expect(await schedule(child)).toEqual([]);
    const personal = await mine(document.id);
    expect(await schedule(child)).toHaveLength(1);
    expect((await request('GET', `/api/reminders/mine?documentId=${document.id}`)).json().reminders).toEqual([]);
    expect((await request('DELETE', `/api/reminders/mine/${personal.id}`)).statusCode).toBe(404);
    expect((await request('DELETE', `/api/reminders/mine/${personal.id}`, {}, child)).statusCode).toBe(200);
    database.db.update(schema.documents).set({ createdBy: null }).where(eq(schema.documents.id, document.id)).run();
    expect(await schedule(member)).toHaveLength(1);
    expect(await schedule(child)).toEqual([]);
    const reminder = stored(document.id)[0]!;
    const members = database.db.select().from(schema.users).all();
    const source = { document, members };
    for (const invalid of [
      { ...reminder, familyId: outsider.id },
      { ...reminder, eventId: crypto.randomUUID() },
      { ...reminder, taskId: crypto.randomUUID() },
      { ...reminder, documentId: crypto.randomUUID() },
      { ...reminder, audience: 'participants' as const },
      { ...reminder, audience: 'list_members' as const },
    ])
      expect(resolveRecipients(invalid, source)).toEqual([]);
  });
  it('preserves legacy schedules and emits absolute expiry text at 09:00 across autumn DST', async () => {
    await add({
      label: 'OC Skoda',
      type: 'car_insurance',
      expiresOn: '2026-11-24',
      reminders: [offset, { ...offset, offsetValue: 29 }],
    });
    expect(await schedule(admin, '')).toEqual([]);
    expect(await schedule(admin, '?includeTasks=true')).toEqual([]);
    expect(await schedule(admin, '?includeDocuments=false')).toEqual([]);
    const entries = await schedule();
    expect(entries.map((r) => new Date(r.fireAt).toISOString())).toEqual([
      '2026-10-25T08:00:00.000Z',
      '2026-10-26T08:00:00.000Z',
    ]);
    expect(entries[0]).toMatchObject({
      sourceType: 'document',
      occurrenceDate: '2026-11-24',
      body: 'OC Skoda — ważne do 24.11.2026',
    });
    const document = await add({ expiresOn: '2026-11-23', reminders: [offset] });
    expect((await schedule()).find((r) => r.sourceId === document.id)?.fireAt).toBe(Date.parse('2026-10-24T07:00:00Z'));
  });
  it('injects snapshot time and handles spring DST at the same local hour', async () => {
    await add({ expiresOn: '2027-04-26', reminders: [offset, { ...offset, offsetValue: 29 }] });
    const result = readReminderSchedule(database, familyId, admin.id, false, true, () =>
      Date.parse('2027-03-01T00:00:00Z'),
    );
    expect(result.reminders.map((r) => new Date(r.fireAt).toISOString())).toEqual([
      '2027-03-27T08:00:00.000Z',
      '2027-03-28T07:00:00.000Z',
    ]);
  });
  it('rejects invalid reminder audiences, ambiguous sources, foreign documents and unauthorized renewal', async () => {
    const document = await add();
    for (const audience of ['participants', 'list_members', 'user', 'bad']) {
      expect(
        (await request('POST', '/api/documents', { ...data, reminders: [{ ...offset, audience }] })).statusCode,
      ).toBe(400);
      expect(
        (await request('PATCH', `/api/documents/${document.id}`, { reminders: [{ ...offset, audience }] })).statusCode,
      ).toBe(400);
    }
    expect(
      (await request('POST', `/api/documents/${document.id}/renew`, { expiresOn: '2027-01-01' }, child)).statusCode,
    ).toBe(403);
    expect(
      (await request('POST', `/api/documents/${document.id}/renew`, { expiresOn: '2027-01-01' }, outsider)).statusCode,
    ).toBe(404);
    for (const body of [{}, { expiresOn: '2027-02-29' }, { expiresOn: '2027-01-01', label: 'x' }])
      expect((await request('POST', `/api/documents/${document.id}/renew`, body)).statusCode).toBe(400);
    for (const documentId of [document.id, crypto.randomUUID()]) {
      expect((await request('POST', '/api/reminders/mine', { documentId, ...offset }, outsider)).statusCode).toBe(404);
      expect(
        (await request('GET', `/api/reminders/mine?documentId=${documentId}`, undefined, outsider)).statusCode,
      ).toBe(404);
    }
    for (const source of [
      {},
      { documentId: document.id, eventId: crypto.randomUUID() },
      { documentId: document.id, taskId: crypto.randomUUID() },
    ]) {
      expect((await request('POST', '/api/reminders/mine', { ...source, ...offset })).statusCode).toBe(400);
      expect((await request('GET', `/api/reminders/mine?${new URLSearchParams(source)}`)).statusCode).toBe(400);
    }
  });
  it('cascades shared and personal reminders when deleting a document', async () => {
    const document = await add({ expiresOn: '2026-11-15' });
    await mine(document.id);
    expect(stored(document.id)).toHaveLength(3);
    expect((await request('DELETE', `/api/documents/${document.id}`)).statusCode).toBe(200);
    expect(stored(document.id)).toEqual([]);
    expect(await schedule(child)).toEqual([]);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  });
});
