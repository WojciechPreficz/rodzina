// @vitest-environment node
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localDateTimeToUtc } from '@rodzina/shared';
import { buildApp } from '../../app.js';
import { hashToken } from '../../auth.js';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../db/client.js';
import * as schema from '../../db/schema.js';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');
const single = { kind: 'single', title: 'Basen', startDate: '2026-10-13', startTime: '17:00', durationMinutes: 60 };

describe('events API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let database: ReturnType<typeof createDatabase>;
  let familyId: string;
  let admin: { id: string; cookie: string };
  let member: { id: string; cookie: string };
  let child: { id: string; cookie: string };
  let outsider: { id: string; cookie: string };

  function actor(family: string, role: 'admin' | 'member' | 'child') {
    const id = crypto.randomUUID();
    const token = crypto.randomUUID();
    database.db
      .insert(schema.users)
      .values({
        id,
        familyId: family,
        displayName: role,
        role,
        color: '#123456',
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
  function family() {
    const id = crypto.randomUUID();
    database.db.insert(schema.families).values({ id, name: 'Rodzina', joinCode: id, createdAt: Date.now() }).run();
    return id;
  }
  function request(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown, user = admin) {
    const body = payload ?? (method === 'DELETE' ? {} : undefined);
    return app.inject({
      method,
      url,
      headers: {
        cookie: user.cookie,
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
  }
  async function create(data: Record<string, unknown> = single, user = admin) {
    const response = await request('POST', '/api/events', data, user);
    expect(response.statusCode, response.body).toBe(201);
    return response.json().event;
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

  it('creates, reads, partially updates and deletes a whole event with participants', async () => {
    const event = await create({ ...single, description: 'Opis', location: 'Szkoła', participantIds: [child.id] });
    expect(event).toMatchObject({ familyId, createdBy: admin.id, participants: [{ id: child.id, color: '#123456' }] });
    expect((await request('GET', `/api/events/${event.id}`, undefined, child)).json().event).toEqual(event);
    const patched = await request(
      'PATCH',
      `/api/events/${event.id}?scope=all`,
      { title: 'Nowy tytuł', participantIds: [member.id] },
      member,
    );
    expect(patched.statusCode).toBe(200);
    expect(patched.json().event).toMatchObject({
      title: 'Nowy tytuł',
      startDate: single.startDate,
      description: 'Opis',
      createdBy: admin.id,
      createdAt: event.createdAt,
      participants: [{ id: member.id }],
    });
    expect(
      (await request('PATCH', `/api/events/${event.id}`, { participantIds: [] })).json().event.participants,
    ).toEqual([]);
    database.db
      .insert(schema.eventExceptions)
      .values({ id: crypto.randomUUID(), eventId: event.id, originalDate: single.startDate, isCancelled: true })
      .run();
    expect((await request('DELETE', `/api/events/${event.id}?scope=all`, undefined, member)).statusCode).toBe(200);
    expect((await request('GET', `/api/events/${event.id}`)).statusCode).toBe(404);
    expect(database.db.select().from(schema.eventParticipants).all()).toEqual([]);
    expect(database.db.select().from(schema.eventExceptions).all()).toEqual([]);
  });

  it('accepts single, recurring and distant events and rejects contradictory data', async () => {
    await create();
    await create({ ...single, kind: 'recurring', rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=3' });
    await create({ ...single, kind: 'distant' });
    await create({ kind: 'distant', title: 'Przegląd', startDate: '2028-05-01', datePrecision: 'month' });
    for (const patch of [
      { kind: 'recurring' },
      { rrule: 'FREQ=DAILY' },
      { datePrecision: 'month' },
      { startDate: '2026-02-30' },
      { kind: 'recurring', rrule: 'invalid' },
      { kind: 'distant', datePrecision: 'month', startDate: '2028-05-02', startTime: null, durationMinutes: null },
      { createdBy: child.id },
      { familyId: crypto.randomUUID() },
      { reminders: [{ type: 'offset', offsetValue: 1, offsetUnit: 'day', audience: 'user' }] },
    ]) {
      const response = await request('POST', '/api/events', { ...single, ...patch });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('validates PATCH against the merged event and preserves data on failure', async () => {
    const event = await create();
    for (const patch of [
      { kind: 'recurring' },
      { datePrecision: 'month' },
      { startTime: null },
      {},
      { createdBy: child.id },
    ]) {
      expect((await request('PATCH', `/api/events/${event.id}`, patch)).statusCode).toBe(400);
      expect((await request('GET', `/api/events/${event.id}`)).json().event).toEqual(event);
    }
    expect(
      (await request('PATCH', `/api/events/${event.id}`, { kind: 'recurring', rrule: 'FREQ=DAILY;COUNT=2' }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await request('PATCH', `/api/events/${event.id}`, {
          kind: 'distant',
          rrule: null,
          datePrecision: 'month',
          startDate: '2028-05-01',
          startTime: null,
          durationMinutes: null,
        })
      ).statusCode,
    ).toBe(200);
  });

  it('expands weekly occurrences across DST and includes only day-precision distant events', async () => {
    const recurring = await create({
      ...single,
      kind: 'recurring',
      startDate: '2026-10-20',
      rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=3',
      participantIds: [child.id],
    });
    const distant = await create({
      ...single,
      kind: 'distant',
      startDate: '2026-10-27',
      startTime: null,
      durationMinutes: null,
    });
    await create({ kind: 'distant', title: 'Miesiąc', startDate: '2026-10-01', datePrecision: 'month' });
    await create({ ...single, startDate: '2026-10-21' });
    const response = await request('GET', '/api/occurrences?from=2026-10-20&to=2026-11-03');
    expect(response.statusCode).toBe(200);
    const occurrences = response.json().occurrences;
    expect(occurrences).toHaveLength(5);
    expect(
      occurrences
        .filter((o: { eventId: string }) => o.eventId === recurring.id)
        .map((o: { startUtc: number }) => o.startUtc),
    ).toEqual(
      ['2026-10-20', '2026-10-27', '2026-11-03'].map((date) => localDateTimeToUtc(date, '17:00', 'Europe/Warsaw')),
    );
    expect(occurrences.find((o: { eventId: string }) => o.eventId === distant.id)).toMatchObject({
      allDay: true,
      title: single.title,
    });
    expect(occurrences[0].participants).toEqual([{ id: child.id, displayName: 'child', color: '#123456' }]);
    expect(occurrences.map((o: { startUtc: number }) => o.startUtc)).toEqual(
      occurrences.map((o: { startUtc: number }) => o.startUtc).sort((a: number, b: number) => a - b),
    );
  });

  it('filters by participant, without matching the creator or unassigned events', async () => {
    const own = await create({ ...single, participantIds: [child.id] });
    await create(single, child);
    expect(
      (await request('GET', `/api/occurrences?from=2026-10-13&to=2026-10-13&userId=${child.id}`))
        .json()
        .occurrences.map((o: { eventId: string }) => o.eventId),
    ).toEqual([own.id]);
    expect(
      (await request('GET', `/api/occurrences?from=2026-10-13&to=2026-10-13&userId=${outsider.id}`)).json().occurrences,
    ).toEqual([]);
  });

  it('validates date ranges, ids and unsupported scopes', async () => {
    const event = await create();
    for (const query of [
      'from=2026-01-01&to=2026-03-04',
      'from=2026-10-13&to=2026-10-12',
      'from=2026-02-30&to=2026-03-01',
      'from=2026-01-01',
      'from=2026-01-01&to=2026-01-02&userId=bad',
    ]) {
      expect((await request('GET', `/api/occurrences?${query}`)).statusCode).toBe(400);
    }
    expect((await request('GET', '/api/occurrences?from=2026-01-01&to=2026-03-03')).statusCode).toBe(200);
    for (const scope of ['this', 'following', 'unknown']) {
      expect((await request('PATCH', `/api/events/${event.id}?scope=${scope}`, { title: 'Zmiana' })).statusCode).toBe(
        400,
      );
      expect((await request('DELETE', `/api/events/${event.id}?scope=${scope}`)).statusCode).toBe(400);
    }
    expect((await request('GET', '/api/events/bad')).statusCode).toBe(400);
  });

  it('allows children to create and modify their own events only', async () => {
    const adultEvent = await create({ ...single, participantIds: [child.id] });
    expect((await request('PATCH', `/api/events/${adultEvent.id}`, { title: 'Zmiana' }, child)).statusCode).toBe(403);
    expect((await request('DELETE', `/api/events/${adultEvent.id}`, undefined, child)).statusCode).toBe(403);
    const own = await create(single, child);
    expect((await request('PATCH', `/api/events/${own.id}`, { title: 'Własne' }, child)).statusCode).toBe(200);
    expect((await request('DELETE', `/api/events/${own.id}`, undefined, child)).statusCode).toBe(200);
  });

  it('isolates every read and mutation from other families and prevents foreign participants', async () => {
    const event = await create({ ...single, kind: 'distant' }, outsider);
    expect((await request('GET', `/api/events/${event.id}`)).statusCode).toBe(404);
    expect((await request('PATCH', `/api/events/${event.id}`, { title: 'Zmiana' })).statusCode).toBe(404);
    expect((await request('DELETE', `/api/events/${event.id}`)).statusCode).toBe(404);
    expect((await request('GET', '/api/occurrences?from=2026-10-13&to=2026-10-13')).json().occurrences).toEqual([]);
    expect((await request('GET', '/api/events/upcoming-distant')).json().events).toEqual([]);
    for (const ids of [[outsider.id], [crypto.randomUUID()], [child.id, child.id]]) {
      expect((await request('POST', '/api/events', { ...single, participantIds: ids })).statusCode).toBe(400);
    }
    const own = await create({ ...single, participantIds: [child.id] });
    expect((await request('PATCH', `/api/events/${own.id}`, { participantIds: [outsider.id] })).statusCode).toBe(400);
    expect((await request('GET', `/api/events/${own.id}`)).json().event.participants).toHaveLength(1);
  });

  it('keeps former members events, clears authorship and cascades participation and sessions', async () => {
    const event = await create({ ...single, participantIds: [child.id, member.id] }, child);
    expect((await request('DELETE', `/api/members/${child.id}`)).statusCode).toBe(200);
    const remaining = (await request('GET', `/api/events/${event.id}`)).json().event;
    expect(remaining.createdBy).toBeNull();
    expect(remaining.participants.map((p: { id: string }) => p.id)).toEqual([member.id]);
    expect(database.db.select().from(schema.sessions).where(eq(schema.sessions.userId, child.id)).all()).toEqual([]);
    expect((await request('GET', `/api/events/${event.id}`, undefined, child)).statusCode).toBe(401);
  });

  it('sorts upcoming distant events and keeps the current imprecise month', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-11T22:30:00Z'));
    const later = await create({ ...single, kind: 'distant', startDate: '2028-05-31' });
    const month = await create({
      kind: 'distant',
      title: 'Październik',
      startDate: '2026-10-01',
      datePrecision: 'month',
    });
    const today = await create({ ...single, kind: 'distant', startDate: '2026-10-12' });
    await create({ ...single, kind: 'distant', startDate: '2026-10-11' });
    await create({ kind: 'distant', title: 'Wrzesień', startDate: '2026-09-01', datePrecision: 'month' });
    await create();
    expect(
      (await request('GET', '/api/events/upcoming-distant')).json().events.map((e: { id: string }) => e.id),
    ).toEqual([month.id, today.id, later.id]);
  });

  it('requires sessions and rejects requests from foreign origins', async () => {
    const event = await create();
    for (const url of [
      '/api/events/' + event.id,
      '/api/events/upcoming-distant',
      '/api/occurrences?from=2026-10-13&to=2026-10-13',
    ]) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
    }
    expect((await app.inject({ method: 'POST', url: '/api/events', payload: single })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/events/${event.id}`,
          headers: { cookie: admin.cookie, origin: 'http://evil.example', host: 'localhost:3000' },
          payload: { title: 'Zmiana' },
        })
      ).statusCode,
    ).toBe(403);
  });
});
