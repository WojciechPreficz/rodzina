// @vitest-environment node
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localDateTimeToUtc, type Reminder } from '@rodzina/shared';
import { buildApp } from '../../app.js';
import { hashToken } from '../../auth.js';
import { loadTestConfig as loadConfig } from '../../config.test-utils.js';
import { createDatabase } from '../../db/client.js';
import * as schema from '../../db/schema.js';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');
const single = { kind: 'single', title: 'Basen', startDate: '2026-10-20', startTime: '17:00', durationMinutes: 60 };
const offset = { type: 'offset', offsetValue: 1, offsetUnit: 'day' };
const utc = (date: string, time = '17:00') => localDateTimeToUtc(date, time, 'Europe/Warsaw');

describe('event reminders API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let database: ReturnType<typeof createDatabase>;
  let familyId: string;
  let admin: { id: string; cookie: string };
  let member: typeof admin;
  let child: typeof admin;
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
      ...(payload === undefined && method !== 'DELETE' ? {} : { payload: JSON.stringify(payload ?? {}) }),
    });
  }
  async function event(data: Record<string, unknown> = single, user = admin) {
    const response = await request('POST', '/api/events', data, user);
    expect(response.statusCode, response.body).toBe(201);
    return response.json().event;
  }
  async function mine(eventId: string, data = offset, user = child): Promise<Reminder> {
    const response = await request('POST', '/api/reminders/mine', { eventId, ...data }, user);
    expect(response.statusCode, response.body).toBe(200);
    return response.json().reminder;
  }
  beforeEach(async () => {
    vi.spyOn(Date, 'now').mockReturnValue(utc('2026-10-12', '12:00'));
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

  it('replaces only shared reminders and preserves personal identities and ownership', async () => {
    const source = await event({ ...single, reminders: [{ ...offset, audience: 'family' }] });
    const personal = await mine(source.id);
    const other = await mine(source.id, offset, member);
    expect(personal).toMatchObject({
      audience: 'user',
      userId: child.id,
      createdBy: child.id,
      eventId: source.id,
      taskId: null,
      documentId: null,
    });
    const response = await request(
      'PATCH',
      `/api/events/${source.id}`,
      { title: 'Nowy tytuł', reminders: [{ ...offset, audience: 'adults' }] },
      member,
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().event.reminders).toHaveLength(1);
    expect(response.json().event.reminders[0].audience).toBe('adults');
    expect(
      (await request('GET', `/api/reminders/mine?eventId=${source.id}`, undefined, child)).json().reminders,
    ).toEqual([personal]);
    expect(
      (await request('GET', `/api/reminders/mine?eventId=${source.id}`, undefined, member)).json().reminders,
    ).toEqual([other]);
    await request('PATCH', `/api/events/${source.id}`, { title: 'Bez zmiany przypomnień' });
    expect((await request('GET', `/api/events/${source.id}`)).json().event.reminders).toEqual(
      response.json().event.reminders,
    );
    await request('PATCH', `/api/events/${source.id}`, { reminders: [] });
    expect(database.db.select().from(schema.reminders).all()).toHaveLength(2);
  });

  it('lets a child manage personal reminders on a parent event but forbids event editing and other owners', async () => {
    const source = await event();
    const personal = await mine(source.id);
    expect((await request('PATCH', `/api/events/${source.id}`, { reminders: [] }, child)).statusCode).toBe(403);
    expect((await request('DELETE', `/api/reminders/mine/${personal.id}`, undefined, admin)).statusCode).toBe(404);
    expect((await request('DELETE', `/api/reminders/mine/${personal.id}`, undefined, child)).statusCode).toBe(200);
    expect((await request('DELETE', `/api/reminders/mine/${personal.id}`, undefined, child)).statusCode).toBe(404);
    await event({ ...single, reminders: [offset] }, child);
  });

  it('recomputes shared and personal offsets after date changes and expires past absolute reminders', async () => {
    const remindAt = utc('2026-10-14');
    const source = await event({ ...single, reminders: [offset, { type: 'absolute', remindAt }] });
    const personal = await mine(source.id);
    expect(personal.nextFireAt).toBe(utc('2026-10-19'));
    vi.spyOn(Date, 'now').mockReturnValue(utc('2026-10-15'));
    const response = await request('PATCH', `/api/events/${source.id}`, { startDate: '2026-10-25' });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().event.reminders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'offset', nextFireAt: utc('2026-10-24') }),
        expect.objectContaining({ type: 'absolute', remindAt, nextFireAt: null }),
      ]),
    );
    const stored = database.db.select().from(schema.reminders).where(eq(schema.reminders.id, personal.id)).get();
    expect(stored).toMatchObject({ id: personal.id, nextFireAt: utc('2026-10-24'), userId: child.id });
  });

  it('handles recurring, all-day and month-precision deadlines through the shared time logic', async () => {
    const recurring = await event({ ...single, kind: 'recurring', rrule: 'FREQ=WEEKLY;COUNT=3', reminders: [offset] });
    expect(recurring.reminders[0].nextFireAt).toBe(utc('2026-10-19'));
    vi.spyOn(Date, 'now').mockReturnValue(utc('2026-10-21'));
    const changed = await request('PATCH', `/api/events/${recurring.id}`, { title: 'Cykl' });
    expect(changed.json().event.reminders[0].nextFireAt).toBe(utc('2026-10-26'));
    const distant = await event({
      kind: 'distant',
      title: 'Termin',
      startDate: '2028-05-01',
      datePrecision: 'month',
      reminders: [offset],
    });
    expect(distant.reminders[0].nextFireAt).toBe(utc('2028-04-30', '09:00'));
    const allDay = await event({ kind: 'single', title: 'Cały dzień', startDate: '2026-10-25', reminders: [offset] });
    expect(allDay.reminders[0].nextFireAt).toBe(utc('2026-10-24', '09:00'));
  });

  it('isolates families and requires an authenticated session', async () => {
    const source = await event();
    const personal = await mine(source.id);
    expect((await request('GET', `/api/reminders/mine?eventId=${source.id}`, undefined, outsider)).statusCode).toBe(
      404,
    );
    expect((await request('POST', '/api/reminders/mine', { eventId: source.id, ...offset }, outsider)).statusCode).toBe(
      404,
    );
    expect((await request('DELETE', `/api/reminders/mine/${personal.id}`, undefined, outsider)).statusCode).toBe(404);
    expect((await request('POST', '/api/reminders/mine', { eventId: crypto.randomUUID(), ...offset })).statusCode).toBe(
      404,
    );
    expect((await app.inject({ method: 'GET', url: `/api/reminders/mine?eventId=${source.id}` })).statusCode).toBe(401);
  });

  it('rejects unsupported audiences, malformed reminder types, forged ownership and missing or multiple sources', async () => {
    const source = await event();
    for (const data of [
      { ...offset, audience: 'user' },
      { ...offset, audience: 'list_members' },
      { ...offset, audience: 'invalid' },
      { ...offset, offsetValue: -1 },
      { ...offset, offsetValue: 1.5 },
      { ...offset, offsetUnit: 'year' },
      { ...offset, remindAt: utc('2026-10-20') },
      { type: 'absolute' },
      { type: 'absolute', remindAt: -1 },
    ]) {
      expect((await request('PATCH', `/api/events/${source.id}`, { reminders: [data] })).statusCode).toBe(400);
    }
    for (const data of [
      offset,
      { ...offset, taskId: crypto.randomUUID() },
      { ...offset, eventId: source.id, documentId: crypto.randomUUID() },
      { ...offset, eventId: source.id, userId: member.id },
      { ...offset, eventId: source.id, audience: 'family' },
      { type: 'absolute', eventId: source.id, remindAt: utc('2026-10-20'), offsetValue: 1 },
    ])
      expect((await request('POST', '/api/reminders/mine', data)).statusCode).toBe(400);
    for (const query of ['', `eventId=${source.id}&taskId=${crypto.randomUUID()}`])
      expect((await request('GET', `/api/reminders/mine?${query}`)).statusCode).toBe(400);
    expect(database.db.select().from(schema.reminders).all()).toEqual([]);
  });

  it('cascades event and member deletion while keeping shared reminders from former members', async () => {
    const source = await event({ ...single, reminders: [offset] }, member);
    await mine(source.id, offset, member);
    const survivor = await mine(source.id, offset, child);
    expect((await request('DELETE', `/api/members/${member.id}`)).statusCode).toBe(200);
    const rows = database.db.select().from(schema.reminders).all();
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([expect.objectContaining({ audience: 'participants', createdBy: null }), survivor]),
    );
    expect((await request('DELETE', `/api/events/${source.id}`)).statusCode).toBe(200);
    expect(database.db.select().from(schema.reminders).all()).toEqual([]);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('enforces exactly one source and personal ownership in the database', async () => {
    const source = await event();
    const personal = await mine(source.id);
    expect(() =>
      database.db
        .insert(schema.reminders)
        .values({ ...personal, id: crypto.randomUUID(), taskId: crypto.randomUUID() })
        .run(),
    ).toThrow();
    expect(() =>
      database.db
        .insert(schema.reminders)
        .values({ ...personal, id: crypto.randomUUID(), eventId: null })
        .run(),
    ).toThrow();
    expect(() =>
      database.db
        .insert(schema.reminders)
        .values({ ...personal, id: crypto.randomUUID(), userId: null })
        .run(),
    ).toThrow();
  });
});
