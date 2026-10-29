// @vitest-environment node
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localDateTimeToUtc, reminderScheduleSchema, type ReminderSchedule, type Reminder } from '@rodzina/shared';
import { buildApp } from '../../app.js';
import { hashToken, hashPassword } from '../../auth.js';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../db/client.js';
import * as schema from '../../db/schema.js';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');
const single = { kind: 'single', title: 'Basen', startDate: '2026-10-20', startTime: '17:00', durationMinutes: 60 };
const offset = { type: 'offset', offsetValue: 1, offsetUnit: 'day' };
const utc = (date: string, time = '17:00') => localDateTimeToUtc(date, time, 'Europe/Warsaw');

const deletionPasswordHash = await hashPassword('password123');

describe('reminder schedule API', () => {
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
      .values({
        id,
        familyId,
        displayName: role,
        role,
        passwordHash: deletionPasswordHash,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
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

  async function schedule(user = admin): Promise<ReminderSchedule> {
    const response = await request('GET', '/api/reminders/schedule', undefined, user);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    return reminderScheduleSchema.parse(response.json());
  }

  it('includes shared and personal reminders only for current recipients and family', async () => {
    for (const audience of ['family', 'adults', 'participants', 'owner'])
      await event({ ...single, title: audience, participantIds: [child.id], reminders: [{ ...offset, audience }] });
    const source = await event({ ...single, title: 'personal' });
    await mine(source.id);
    await mine(source.id, offset, member);
    await event({ ...single, title: 'foreign', reminders: [{ ...offset, audience: 'family' }] }, outsider);
    const titles = async (user: typeof admin) =>
      (await schedule(user)).reminders.map((r) => r.title.split(': ').at(-1));
    expect(await titles(child)).toEqual(expect.arrayContaining(['family (child)', 'participants (child)', 'personal']));
    expect((await schedule(child)).reminders).toHaveLength(3);
    expect((await schedule(member)).reminders).toHaveLength(3);
    expect((await schedule(admin)).reminders).toHaveLength(3);
    expect((await schedule(outsider)).reminders).toHaveLength(1);
    expect((await app.inject({ method: 'GET', url: '/api/reminders/schedule' })).statusCode).toBe(401);
    expect((await request('GET', `/api/reminders/schedule?familyId=${familyId}`)).statusCode).toBe(400);
  });

  it('has no Web Push routes while keeping the APK schedule available', async () => {
    for (const [method, url] of [
      ['GET', '/api/push/public-key'],
      ['GET', '/api/push/status'],
      ['POST', '/api/push/subscriptions'],
      ['DELETE', '/api/push/subscriptions'],
      ['POST', '/api/push/test'],
    ] as const) {
      expect(app.hasRoute({ method, url })).toBe(false);
      expect((await request(method, url, method === 'GET' ? undefined : {})).statusCode).toBe(404);
    }
    expect((await schedule()).reminders).toEqual([]);
  });

  it('uses current recipients and fallback adults after the creator is removed', async () => {
    const source = await event({ ...single, reminders: [offset] }, member);
    expect((await schedule(member)).reminders).toHaveLength(1);
    expect((await schedule(admin)).reminders).toHaveLength(0);
    expect((await request('DELETE', `/api/members/${member.id}`, { password: 'password123' })).statusCode).toBe(200);
    expect((await schedule(admin)).reminders[0]?.sourceId).toBe(source.id);
    expect((await schedule(child)).reminders).toHaveLength(0);
  });

  it('returns the whole window beyond the calendar limit, including exceptions moved into it', async () => {
    await event({
      ...single,
      startDate: '2026-10-12',
      kind: 'recurring',
      rrule: 'FREQ=DAILY',
      reminders: [{ ...offset, offsetValue: 0, audience: 'family' }],
    });
    expect((await schedule()).reminders).toHaveLength(90);
    const source = await event({
      ...single,
      startDate: '2026-01-01',
      kind: 'recurring',
      rrule: 'FREQ=DAILY;COUNT=2',
      reminders: [{ ...offset, audience: 'family' }],
    });
    await request('PATCH', `/api/events/${source.id}?scope=this&occurrenceDate=2026-01-01`, {
      startDate: '2026-10-20',
    });
    const moved = (await schedule()).reminders.filter((r) => r.sourceId === source.id);
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ occurrenceDate: '2026-01-01', fireAt: utc('2026-10-19') });
  });

  it('includes every month-end occurrence when multiple offsets clamp to the same day', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(utc('2027-02-27', '00:00'));
    database.db
      .update(schema.sessions)
      .set({ expiresAt: Date.now() + 86400000 })
      .run();
    await event({
      ...single,
      startDate: '2027-03-28',
      kind: 'recurring',
      rrule: 'FREQ=DAILY;COUNT=4',
      reminders: [{ type: 'offset', offsetValue: 1, offsetUnit: 'month', audience: 'family' }],
    });
    const result = await schedule();
    expect(result.reminders).toHaveLength(4);
    expect(result.reminders.map((r) => r.fireAt)).toEqual(Array(4).fill(utc('2027-02-28')));
  });

  it('preserves keys and cron reservations across reads, date and title updates', async () => {
    const source = await event({ ...single, reminders: [{ ...offset, audience: 'family' }] });
    // A cron reservation is never a local delivery receipt.
    database.db.update(schema.reminders).set({ nextFireAt: null, lastSentAt: Date.now() }).run();
    const rows = database.db.select().from(schema.reminders).all();
    const first = await schedule();
    expect(await schedule()).toEqual(first);
    expect(database.db.select().from(schema.reminders).all()).toEqual(rows);
    expect(first.reminders[0]).toMatchObject({
      title: '20.10.2026 17:00: Basen',
      body: '',
      occurrenceDate: '2026-10-20',
      fireAt: utc('2026-10-19'),
      url: `/kalendarz/wydarzenie/${source.id}?data=2026-10-20`,
    });
    await request('PATCH', `/api/events/${source.id}`, { startTime: '18:00', title: 'Nowy' });
    expect((await schedule()).reminders[0]).toMatchObject({
      key: first.reminders[0]!.key,
      title: '20.10.2026 18:00: Nowy',
    });
    await request('DELETE', `/api/events/${source.id}`);
    expect((await schedule()).reminders).toEqual([]);
  });

  it('handles cancellation, simultaneous moved occurrences and stable original URLs', async () => {
    const source = await event({
      ...single,
      kind: 'recurring',
      rrule: 'FREQ=DAILY;COUNT=3',
      reminders: [{ ...offset, audience: 'family' }],
    });
    const original = await schedule();
    await request('PATCH', `/api/events/${source.id}?scope=this&occurrenceDate=2026-10-20`, {
      startDate: '2026-10-21',
      title: 'Przeniesiony',
    });
    await request('DELETE', `/api/events/${source.id}?scope=this&occurrenceDate=2026-10-22`);
    const changed = await schedule();
    expect(changed.reminders).toHaveLength(2);
    expect(new Set(changed.reminders.map((r) => r.key)).size).toBe(2);
    expect(changed.reminders.map((r) => r.fireAt)).toEqual([utc('2026-10-20'), utc('2026-10-20')]);
    expect(changed.reminders.find((r) => r.occurrenceDate === '2026-10-20')).toMatchObject({
      key: original.reminders[0]!.key,
      title: '21.10.2026 17:00: Przeniesiony',
      url: `/kalendarz/wydarzenie/${source.id}?data=2026-10-20`,
    });
  });

  it('replaces following occurrences after splitting a series and transfers personal reminders', async () => {
    const source = await event({
      ...single,
      kind: 'recurring',
      rrule: 'FREQ=DAILY;COUNT=3',
      reminders: [{ ...offset, audience: 'family' }],
    });
    await mine(source.id);
    const first = (await schedule()).reminders[0]!;
    const response = await request('PATCH', `/api/events/${source.id}?scope=following&occurrenceDate=2026-10-21`, {
      startTime: '18:00',
    });
    expect(response.statusCode, response.body).toBe(200);
    const nextId = response.json().event.id;
    const updated = await schedule();
    expect(updated.reminders).toHaveLength(3);
    expect(updated.reminders[0]).toEqual(first);
    expect(updated.reminders.slice(1).map((r) => r.sourceId)).toEqual([nextId, nextId]);
    const personal = (await schedule(child)).reminders.filter((r) => r.sourceId === nextId);
    expect(personal).toHaveLength(4);
  });

  it('includes month precision, all-day 09:00 and offsets for deadlines beyond 90 days', async () => {
    await event({
      kind: 'distant',
      title: 'Miesiąc',
      datePrecision: 'month',
      startDate: '2027-01-01',
      reminders: [{ ...offset, audience: 'family' }],
    });
    await event({
      kind: 'distant',
      title: 'Odległy',
      startDate: '2028-10-20',
      reminders: [{ type: 'offset', offsetValue: 24, offsetUnit: 'month', audience: 'family' }],
    });
    const result = await schedule();
    expect(result.reminders).toHaveLength(2);
    expect(result.reminders[0]).toMatchObject({ fireAt: utc('2026-10-20', '09:00'), title: '20.10.2028: Odległy' });
    expect(result.reminders[1]).toMatchObject({ fireAt: utc('2026-12-31', '09:00'), title: '01.2027: Miesiąc' });
  });

  it('uses a strict future and inclusive 90-day boundary for offsets and absolute reminders', async () => {
    const now = Date.now();
    const end = now + 90 * 86400000;
    await event({
      ...single,
      reminders: [now - 1, now, now + 1, end, end + 1].map((remindAt) => ({
        type: 'absolute',
        remindAt,
        audience: 'family',
      })),
    });
    // Exactly the upper boundary, with a reminder based on an event time.
    const endDate = new Date(end).toISOString().slice(0, 10);
    await event({
      ...single,
      startDate: endDate,
      startTime: '11:00',
      reminders: [{ type: 'offset', offsetValue: 0, offsetUnit: 'minute', audience: 'family' }],
    });
    const result = await schedule();
    expect(result).toMatchObject({ generatedAt: now, validUntil: end });
    expect(result.reminders.map((r) => r.fireAt)).toEqual([now + 1, end, end]);
  });

  it.each(['2026-10-23', '2027-03-26'])('keeps wall-clock times across DST from %s', async (startDate) => {
    vi.spyOn(Date, 'now').mockReturnValue(utc(startDate, '00:00'));
    database.db
      .update(schema.sessions)
      .set({ expiresAt: Date.now() + 86400000 })
      .run();
    await event({
      ...single,
      startDate,
      kind: 'recurring',
      rrule: 'FREQ=DAILY;COUNT=5',
      reminders: [{ ...offset, audience: 'family' }],
    });
    const result = await schedule();
    expect(result.reminders).toHaveLength(4);
    for (const alarm of result.reminders) {
      const previous = new Date(`${alarm.occurrenceDate}T00:00:00Z`);
      previous.setUTCDate(previous.getUTCDate() - 1);
      expect(alarm.fireAt).toBe(utc(previous.toISOString().slice(0, 10)));
    }
    const gaps = result.reminders.slice(1).map((r, i) => (r.fireAt - result.reminders[i]!.fireAt) / 3600000);
    expect(gaps).toContain(startDate.startsWith('2026') ? 25 : 23);
  });
});
