// @vitest-environment node
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localDateTimeToUtc } from '@rodzina/shared';
import { buildApp } from '../../app.js';
import { hashToken, hashPassword } from '../../auth.js';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../db/client.js';
import * as schema from '../../db/schema.js';
import { trustedMutationHeaders } from '../../test-helpers.js';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');
const single = { kind: 'single', title: 'Basen', startDate: '2026-10-13', startTime: '17:00', durationMinutes: 60 };

const deletionPasswordHash = await hashPassword('password123');

describe('events API', () => {
  it.each([null, '18:30'])('stores a single event with optional time %s and no duration', async (startTime) => {
    const event = await create({ ...single, startTime, durationMinutes: null });
    expect(event).toMatchObject({ startTime, durationMinutes: null });
    const response = await request('GET', '/api/occurrences?from=2026-10-13&to=2026-10-13');
    const occurrence = response.json().occurrences.find((item: { eventId: string }) => item.eventId === event.id);
    expect(occurrence).toBeDefined();
    if (startTime) expect(occurrence.endUtc).toBe(occurrence.startUtc);
    const patched = await request('PATCH', `/api/events/${event.id}`, { title: 'Zmieniony tytuł' });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().event).toMatchObject({ startTime, durationMinutes: null });
  });
  it.each([null, '09:00'])(
    'keeps multi-day single events in later date ranges with startTime=%s',
    async (startTime) => {
      const event = await create({ ...single, startDate: '2026-10-24', startTime, durationMinutes: 4320 });
      const response = await request('GET', '/api/occurrences?from=2026-10-26&to=2026-10-26');
      expect(response.statusCode).toBe(200);
      expect(response.json().occurrences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ eventId: event.id, occurrenceDate: '2026-10-24', allDay: startTime === null }),
        ]),
      );
      const changed = await request('PATCH', `/api/events/${event.id}`, { durationMinutes: 5760 });
      expect(changed.statusCode).toBe(200);
      expect(changed.json().event.durationMinutes).toBe(5760);
    },
  );
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
        passwordHash: deletionPasswordHash,
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
        ...trustedMutationHeaders(),
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

  describe('duplicate event decisions', () => {
    const candidates = (title = single.title, startDate = single.startDate, user = admin) =>
      request('GET', `/api/events/duplicates?${new URLSearchParams({ title, startDate })}`, undefined, user);
    it('matches normalized title and date in the current family and requires an explicit decision', async () => {
      const existing = await create();
      const matches = (await candidates('  BASEN  ')).json().duplicates;
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({ eventId: existing.id, canReplace: true });
      expect((await candidates(single.title, '2026-10-14')).json().duplicates).toEqual([]);
      expect((await candidates('Inne wydarzenie')).json().duplicates).toEqual([]);
      expect((await candidates(single.title, single.startDate, outsider)).json().duplicates).toEqual([]);
      expect(
        (await request('POST', '/api/events?duplicateAction=check', { ...single, title: 'BASEN' })).statusCode,
      ).toBe(409);
      expect((await request('POST', '/api/events?duplicateAction=add', single)).statusCode).toBe(201);
      expect((await candidates()).json().duplicates).toHaveLength(2);
    });
    it('replaces the chosen event in place and rejects a stale decision', async () => {
      const existing = await create();
      const match = (await candidates()).json().duplicates[0];
      const url = `/api/events?${new URLSearchParams({ duplicateAction: 'replace', duplicateEventId: existing.id, duplicateVersion: match.version })}`;
      const replacement = await request('POST', url, { ...single, startTime: '19:00', description: 'Nowe dane' });
      expect(replacement.statusCode).toBe(201);
      expect(replacement.json().event).toMatchObject({
        id: existing.id,
        createdBy: admin.id,
        startTime: '19:00',
        description: 'Nowe dane',
      });
      expect((await request('POST', url, { ...single, description: 'Nieaktualne' })).statusCode).toBe(409);
      expect((await candidates()).json().duplicates).toHaveLength(1);
      expect((await request('GET', `/api/events/${existing.id}`)).json().event.description).toBe('Nowe dane');
    });
    it('persists the import replacement decision and retries without repeating an update', async () => {
      const existing = await create();
      const first = { operationId: crypto.randomUUID(), event: single, duplicateResolution: { action: 'check' } };
      const conflict = (await request('POST', '/api/events/import', { items: [first] })).json().results[0];
      expect(conflict).toMatchObject({ status: 'error', error: { code: 'DUPLICATE_EVENT' } });
      const chosen = conflict.error.duplicates[0];
      const operation = {
        operationId: crypto.randomUUID(),
        event: { ...single, description: 'Z importu' },
        duplicateResolution: { action: 'replace', eventId: chosen.eventId, version: chosen.version },
      };
      const imported = await request('POST', '/api/events/import', { items: [operation] });
      expect(imported.json().results[0]).toMatchObject({ status: 'created', eventId: existing.id });
      await request('PATCH', `/api/events/${existing.id}`, { description: 'Późniejsza zmiana' });
      expect((await request('POST', '/api/events/import', { items: [operation] })).json().results[0]).toMatchObject({
        status: 'already_created',
        eventId: existing.id,
      });
      expect((await request('GET', `/api/events/${existing.id}`)).json().event.description).toBe('Późniejsza zmiana');
      const changed = { ...operation, duplicateResolution: { action: 'add' } };
      expect((await request('POST', '/api/events/import', { items: [changed] })).json().results[0]).toMatchObject({
        status: 'error',
        error: { code: 'OPERATION_CONFLICT' },
      });
    });
    it('keeps replacement permissions and family isolation, including recurring matches', async () => {
      const existing = await create();
      const childMatch = (await candidates(single.title, single.startDate, child)).json().duplicates[0];
      expect(childMatch.canReplace).toBe(false);
      const replace = { action: 'replace', eventId: existing.id, version: childMatch.version };
      const denied = await request(
        'POST',
        '/api/events/import',
        { items: [{ operationId: crypto.randomUUID(), event: single, duplicateResolution: replace }] },
        child,
      );
      expect(denied.json().results[0]).toMatchObject({ status: 'error', error: { code: 'FORBIDDEN' } });
      const foreign = await request(
        'POST',
        '/api/events/import',
        { items: [{ operationId: crypto.randomUUID(), event: single, duplicateResolution: replace }] },
        outsider,
      );
      expect(foreign.json().results[0]).toMatchObject({
        status: 'error',
        error: { code: 'DUPLICATE_EVENT', duplicates: [] },
      });
      await create({ ...single, title: 'Codzienny basen', kind: 'recurring', rrule: 'FREQ=DAILY;COUNT=3' });
      const series = (await candidates('Codzienny basen', '2026-10-14')).json().duplicates;
      expect(series).toHaveLength(1);
      expect(series[0].canReplace).toBe(false);
    });
    it('checks atomically when two imports race', async () => {
      const submit = () =>
        request('POST', '/api/events/import', {
          items: [{ operationId: crypto.randomUUID(), event: single, duplicateResolution: { action: 'check' } }],
        });
      const responses = await Promise.all([submit(), submit()]);
      expect(responses.map((response) => response.json().results[0].status).sort()).toEqual(['created', 'error']);
      expect((await candidates()).json().duplicates).toHaveLength(1);
    });
    it('rolls back a replacement when its success record cannot be committed', async () => {
      const original = await create({ ...single, participantIds: [member.id], description: 'Zachowaj' });
      const match = (await candidates()).json().duplicates[0];
      const operationId = crypto.randomUUID();
      database.sqlite.exec(
        `CREATE TRIGGER fail_replace BEFORE INSERT ON event_import_operations WHEN NEW.id = '${operationId}' BEGIN SELECT RAISE(ABORT, 'test failure'); END;`,
      );
      const response = await request('POST', '/api/events/import', {
        items: [
          {
            operationId,
            event: { ...single, description: 'Nie zapisuj' },
            duplicateResolution: { action: 'replace', eventId: original.id, version: match.version },
          },
        ],
      });
      expect(response.json().results[0]).toMatchObject({ status: 'error', error: { code: 'INTERNAL_ERROR' } });
      expect((await request('GET', `/api/events/${original.id}`)).json().event).toEqual(original);
      expect(database.db.select().from(schema.eventImportOperations).all()).toHaveLength(0);
    });
  });

  describe('photo event import', () => {
    const item = (event: unknown = single) => ({ operationId: crypto.randomUUID(), event });
    const importBatch = (items: unknown[], user = admin) => request('POST', '/api/events/import', { items }, user);

    it.each(['admin', 'member', 'child'] as const)('imports for %s with the existing event rules', async (role) => {
      const user = { admin, member, child }[role];
      const items = [item({ ...single, participantIds: [child.id] }), item({ ...single, title: 'Drugie' })];
      const startedAt = Date.now();
      const response = await importBatch(items, user);
      const finishedAt = Date.now();
      expect(response.statusCode).toBe(200);
      expect(response.json().results).toEqual(
        items.map(({ operationId }) => ({ operationId, status: 'created', eventId: expect.any(String) })),
      );
      const operations = database.db.select().from(schema.eventImportOperations).all();
      expect(operations).toHaveLength(items.length);
      for (const { createdAt } of operations) {
        expect(createdAt).toBeGreaterThanOrEqual(startedAt);
        expect(createdAt).toBeLessThanOrEqual(finishedAt);
      }
      for (const result of response.json().results) {
        expect((await request('GET', `/api/events/${result.eventId}`, undefined, user)).json().event).toMatchObject({
          familyId,
          createdBy: user.id,
          kind: 'single',
        });
      }
    });

    it('returns independent validation errors and allows correcting failed operations', async () => {
      const items = [
        item(),
        item(null),
        item({ ...single, startDate: '2026-02-29' }),
        item({ ...single, participantIds: [outsider.id] }),
        item({ ...single, kind: 'recurring', rrule: 'FREQ=DAILY' }),
        item({ ...single, kind: 'distant' }),
        item({ ...single, reminders: [{ type: 'offset' }] }),
        item({ ...single, title: 'Koniec' }),
      ];
      const response = await importBatch(items);
      expect(response.statusCode).toBe(200);
      expect(response.json().results.map((result: { status: string }) => result.status)).toEqual([
        'created',
        'error',
        'error',
        'error',
        'error',
        'error',
        'error',
        'created',
      ]);
      for (const result of response.json().results.slice(1, -1)) {
        expect(result.error).toMatchObject({ code: 'VALIDATION_ERROR', message: expect.any(String) });
      }
      expect(database.db.select().from(schema.events).all()).toHaveLength(2);
      expect(database.db.select().from(schema.eventImportOperations).all()).toHaveLength(2);
      expect((await importBatch([{ ...items[1], event: single }])).json().results[0].status).toBe('created');
    });

    it('validates the entire envelope before any write', async () => {
      const valid = item();
      for (const payload of [
        null,
        [],
        {},
        { items: [] },
        { items: Array.from({ length: 21 }, () => item()) },
        { items: [valid, valid] },
        { items: [valid, { operationId: 'bad', event: single }] },
        { items: [valid, { operationId: crypto.randomUUID() }] },
        { items: [valid, null] },
        { items: [valid], rawOcr: 'text' },
        { items: [{ ...valid, image: 'data' }] },
      ]) {
        const response = await request('POST', '/api/events/import', payload);
        expect(response.statusCode, response.body).toBe(400);
        expect(response.json().error.code).toBe('VALIDATION_ERROR');
      }
      expect(database.db.select().from(schema.events).all()).toHaveLength(0);
      const response = await importBatch(Array.from({ length: 20 }, () => item()));
      expect(response.json().results.every((result: { status: string }) => result.status === 'created')).toBe(true);
      expect(database.db.select().from(schema.events).all()).toHaveLength(20);
    });

    it('replays lost responses and concurrent requests without duplicate events', async () => {
      const items = [item(), item()];
      const responses = await Promise.all(Array.from({ length: 5 }, () => importBatch(items)));
      expect(responses.every((response) => response.statusCode === 200)).toBe(true);
      for (let index = 0; index < items.length; index++) {
        const results = responses.map((response) => response.json().results[index]);
        expect(results.filter((result) => result.status === 'created')).toHaveLength(1);
        expect(results.filter((result) => result.status === 'already_created')).toHaveLength(4);
        expect(new Set(results.map((result) => result.eventId)).size).toBe(1);
      }
      expect(database.db.select().from(schema.events).all()).toHaveLength(2);
      expect((await importBatch(items)).json().results.map((result: { status: string }) => result.status)).toEqual([
        'already_created',
        'already_created',
      ]);
    });

    it('hashes normalized event data and rejects reuse with different data', async () => {
      const original = item({ ...single, title: ' Basen ' });
      const first = (await importBatch([original])).json().results[0];
      const retry = {
        ...original,
        event: {
          durationMinutes: 60,
          startTime: '17:00',
          startDate: single.startDate,
          title: 'Basen',
          kind: 'single',
          description: null,
          participantIds: [],
        },
      };
      expect((await importBatch([retry])).json().results[0]).toEqual({ ...first, status: 'already_created' });
      expect(
        (await importBatch([{ ...original, event: { ...single, title: 'Inne' } }])).json().results[0],
      ).toMatchObject({ operationId: original.operationId, status: 'error', error: { code: 'OPERATION_CONFLICT' } });
      expect(database.db.select().from(schema.events).all()).toHaveLength(1);
    });

    it('retains success after event deletion and service restart', async () => {
      const items = [item()];
      const result = (await importBatch(items)).json().results[0];
      expect((await request('DELETE', `/api/events/${result.eventId}`)).statusCode).toBe(200);
      await app.close();
      app = await buildApp(loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' }), database);
      expect((await importBatch(items)).json().results[0]).toEqual({ ...result, status: 'already_created' });
      expect(database.db.select().from(schema.events).all()).toHaveLength(0);
      expect(database.db.select().from(schema.eventImportOperations).all()).toHaveLength(1);
    });

    it('rolls back event, participants and reminders if saving the operation fails', async () => {
      const failed = item({
        ...single,
        participantIds: [member.id],
        reminders: [{ type: 'offset', offsetValue: 1, offsetUnit: 'day' }],
      });
      database.sqlite.exec(`CREATE TRIGGER fail_import BEFORE INSERT ON event_import_operations
        WHEN NEW.id = '${failed.operationId}' BEGIN SELECT RAISE(ABORT, 'test failure'); END;`);
      const response = await importBatch([failed, item()]);
      expect(response.json().results[0]).toMatchObject({ status: 'error', error: { code: 'INTERNAL_ERROR' } });
      expect(response.json().results[1].status).toBe('created');
      expect(database.db.select().from(schema.events).all()).toHaveLength(1);
      expect(database.db.select().from(schema.eventImportOperations).all()).toHaveLength(1);
      expect(database.db.select().from(schema.eventParticipants).all()).toHaveLength(0);
      expect(database.db.select().from(schema.reminders).all()).toHaveLength(0);
      database.sqlite.exec('DROP TRIGGER fail_import');
      expect((await importBatch([failed])).json().results[0].status).toBe('created');
      expect(database.db.select().from(schema.reminders).all()).toHaveLength(1);
    });

    it('isolates operations by account and family and checks current access before replay', async () => {
      const items = [item()];
      const first = (await importBatch(items)).json().results[0];
      for (const user of [member, outsider]) {
        const result = (await importBatch(items, user)).json().results[0];
        expect(result.status).toBe('created');
        expect(result.eventId).not.toBe(first.eventId);
      }
      const assigned = item({ ...single, participantIds: [child.id] });
      await importBatch([assigned]);
      database.db.delete(schema.users).where(eq(schema.users.id, child.id)).run();
      expect((await importBatch([assigned])).json().results[0]).toMatchObject({
        status: 'error',
        error: { code: 'VALIDATION_ERROR' },
      });
      database.db.delete(schema.sessions).where(eq(schema.sessions.userId, admin.id)).run();
      expect((await importBatch(items)).statusCode).toBe(401);
    });

    it('removes success records only when the account or family is deleted', async () => {
      await importBatch([item()], child);
      await importBatch([item()], outsider);
      database.db.delete(schema.users).where(eq(schema.users.id, child.id)).run();
      expect(database.db.select().from(schema.eventImportOperations).all()).toHaveLength(1);
      database.db.delete(schema.families).where(eq(schema.families.id, familyId)).run();
      expect(database.db.select().from(schema.eventImportOperations).all()).toHaveLength(1);
      database.db
        .delete(schema.families)
        .where(
          eq(
            schema.families.id,
            database.db.select().from(schema.users).where(eq(schema.users.id, outsider.id)).get()!.familyId,
          ),
        )
        .run();
      expect(database.db.select().from(schema.eventImportOperations).all()).toHaveLength(0);
    });
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
    expect((await request('DELETE', `/api/members/${child.id}`, { password: 'password123' })).statusCode).toBe(200);
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
    expect(
      (await app.inject({ method: 'POST', url: '/api/events', headers: trustedMutationHeaders(), payload: single }))
        .statusCode,
    ).toBe(401);
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

  it('upserts moved exceptions, applies their title and cancels individual occurrences', async () => {
    const event = await create({ ...single, kind: 'recurring', rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=4' });
    const url = `/api/events/${event.id}?scope=this&occurrenceDate=2026-10-20`;
    const moved = await request('PATCH', url, { startDate: '2026-11-02', title: 'Przeniesiony basen' });
    expect(moved.statusCode, moved.body).toBe(200);
    const exceptionId = moved.json().event.exceptions[0].id;
    const changed = await request('PATCH', url, { startTime: '18:00' });
    expect(changed.json().event.exceptions).toMatchObject([{ id: exceptionId, overrideStartDate: '2026-11-02' }]);
    expect(changed.json().event.exceptions).toHaveLength(1);
    expect((await request('GET', '/api/occurrences?from=2026-10-20&to=2026-10-20')).json().occurrences).toEqual([]);
    const occurrences = (await request('GET', '/api/occurrences?from=2026-11-02&to=2026-11-02')).json().occurrences;
    expect(occurrences).toMatchObject([
      {
        eventId: event.id,
        occurrenceDate: '2026-10-20',
        isException: true,
        title: 'Przeniesiony basen',
        startUtc: localDateTimeToUtc('2026-11-02', '18:00', 'Europe/Warsaw'),
      },
    ]);
    expect((await request('DELETE', url)).statusCode).toBe(200);
    expect((await request('GET', '/api/occurrences?from=2026-11-02&to=2026-11-02')).json().occurrences).toEqual([]);
    const restored = await request('PATCH', url, { title: 'Przywrócone' });
    expect(restored.json().event.exceptions[0].isCancelled).toBe(false);
  });

  it('splits a counted series without altering earlier occurrences and transfers personal reminders', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(localDateTimeToUtc('2026-10-12', '12:00', 'Europe/Warsaw'));
    const event = await create({
      ...single,
      kind: 'recurring',
      rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=4',
      participantIds: [child.id],
      reminders: [{ type: 'offset', offsetValue: 1, offsetUnit: 'day', audience: 'family' }],
    });
    const personal = (
      await request(
        'POST',
        '/api/reminders/mine',
        {
          eventId: event.id,
          type: 'offset',
          offsetValue: 1,
          offsetUnit: 'hour',
        },
        child,
      )
    ).json().reminder;
    const past = (await request('GET', '/api/occurrences?from=2026-10-13&to=2026-10-20')).json().occurrences;
    const response = await request(
      'PATCH',
      `/api/events/${event.id}?scope=following&occurrenceDate=2026-10-27`,
      {
        title: 'Nowa seria',
        startTime: '18:00',
      },
      member,
    );
    expect(response.statusCode, response.body).toBe(200);
    const next = response.json().event;
    expect(next.id).not.toBe(event.id);
    expect(next.rrule).toContain('COUNT=2');
    expect(next.participants).toEqual(event.participants);
    expect(next.reminders[0].createdBy).toBe(admin.id);
    expect((await request('GET', '/api/occurrences?from=2026-10-13&to=2026-10-20')).json().occurrences).toEqual(past);
    const transferred = (await request('GET', `/api/reminders/mine?eventId=${next.id}`, undefined, child)).json()
      .reminders;
    expect(transferred).toMatchObject([
      {
        id: personal.id,
        eventId: next.id,
        userId: child.id,
        createdBy: child.id,
        nextFireAt: localDateTimeToUtc('2026-10-27', '17:00', 'Europe/Warsaw'),
      },
    ]);
    expect(
      (await request('GET', `/api/reminders/mine?eventId=${event.id}`, undefined, child)).json().reminders,
    ).toEqual([]);
    const future = (await request('GET', '/api/occurrences?from=2026-10-27&to=2026-11-30')).json().occurrences;
    expect(future.map((item: { occurrenceDate: string }) => item.occurrenceDate)).toEqual(['2026-10-27', '2026-11-03']);
    expect((await request('GET', `/api/events/${event.id}`)).json().event.rrule).toContain('UNTIL=20261026T235959');
  });

  it('deletes following occurrences including future exceptions and recalculates reminders', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(localDateTimeToUtc('2026-10-12', '12:00', 'Europe/Warsaw'));
    const event = await create({
      ...single,
      kind: 'recurring',
      rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=4',
      reminders: [{ type: 'offset', offsetValue: 0, offsetUnit: 'minute' }],
    });
    await request('PATCH', `/api/events/${event.id}?scope=this&occurrenceDate=2026-10-27`, { startDate: '2026-10-14' });
    expect(
      (await request('DELETE', `/api/events/${event.id}?scope=following&occurrenceDate=2026-10-20`)).statusCode,
    ).toBe(200);
    const remaining = (await request('GET', `/api/events/${event.id}`)).json().event;
    expect(remaining.exceptions).toEqual([]);
    expect(remaining.reminders[0].nextFireAt).toBe(localDateTimeToUtc('2026-10-13', '17:00', 'Europe/Warsaw'));
    expect((await request('GET', '/api/occurrences?from=2026-10-13&to=2026-11-10')).json().occurrences).toHaveLength(1);
    await request('DELETE', `/api/events/${event.id}?scope=this&occurrenceDate=2026-10-13`);
    expect((await request('GET', `/api/events/${event.id}`)).json().event.reminders[0].nextFireAt).toBeNull();
  });

  it('retains UNTIL and future exceptions when splitting the same schedule', async () => {
    const event = await create({
      ...single,
      kind: 'recurring',
      rrule: 'FREQ=WEEKLY;BYDAY=TU;UNTIL=20261103T235959',
    });
    await request('PATCH', `/api/events/${event.id}?scope=this&occurrenceDate=2026-10-27`, {
      startDate: '2026-10-28',
      startTime: null,
      durationMinutes: null,
    });
    await request('DELETE', `/api/events/${event.id}?scope=this&occurrenceDate=2026-11-03`);
    const response = await request('PATCH', `/api/events/${event.id}?scope=following&occurrenceDate=2026-10-20`, {
      title: 'Nowy tytuł serii',
    });
    expect(response.statusCode, response.body).toBe(200);
    const next = response.json().event;
    expect(next.rrule).toBe(event.rrule);
    expect(next.exceptions).toHaveLength(2);
    expect((await request('GET', `/api/events/${event.id}`)).json().event.exceptions).toEqual([]);
    const occurrences = (await request('GET', '/api/occurrences?from=2026-10-20&to=2026-11-30')).json().occurrences;
    expect(occurrences.map((item: { occurrenceDate: string }) => item.occurrenceDate)).toEqual([
      '2026-10-20',
      '2026-10-27',
    ]);
    expect(occurrences[1]).toMatchObject({ eventId: next.id, allDay: true, isException: true });
    expect(occurrences[1].startUtc).toBe(localDateTimeToUtc('2026-10-28', '00:00', 'Europe/Warsaw'));
  });

  it('splits at the first occurrence and replaces only shared reminders in the new series', async () => {
    const event = await create({
      ...single,
      kind: 'recurring',
      rrule: 'FREQ=WEEKLY;COUNT=2',
      reminders: [{ type: 'offset', offsetValue: 1, offsetUnit: 'day' }],
    });
    const personal = (
      await request(
        'POST',
        '/api/reminders/mine',
        {
          eventId: event.id,
          type: 'offset',
          offsetValue: 1,
          offsetUnit: 'hour',
        },
        child,
      )
    ).json().reminder;
    const response = await request('PATCH', `/api/events/${event.id}?scope=following&occurrenceDate=2026-10-13`, {
      title: 'Nowa',
      reminders: [],
    });
    expect(response.statusCode, response.body).toBe(200);
    const next = response.json().event;
    expect(next.reminders).toEqual([]);
    expect(
      (await request('GET', `/api/reminders/mine?eventId=${next.id}`, undefined, child)).json().reminders[0].id,
    ).toBe(personal.id);
    const occurrences = (await request('GET', '/api/occurrences?from=2026-10-13&to=2026-11-03')).json().occurrences;
    expect(occurrences).toHaveLength(2);
    expect(occurrences.every((item: { eventId: string }) => item.eventId === next.id)).toBe(true);
    expect(
      (await request('DELETE', `/api/events/${next.id}?scope=following&occurrenceDate=2026-10-13`)).statusCode,
    ).toBe(200);
    expect((await request('GET', '/api/occurrences?from=2026-10-13&to=2026-11-03')).json().occurrences).toEqual([]);
  });

  it('validates occurrence scopes and keeps family and child permissions', async () => {
    const event = await create({ ...single, kind: 'recurring', rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=4' });
    for (const scope of ['this', 'following']) {
      for (const date of ['', '&occurrenceDate=2026-10-14', '&occurrenceDate=invalid']) {
        expect(
          (await request('PATCH', `/api/events/${event.id}?scope=${scope}${date}`, { title: 'Zmiana' })).statusCode,
        ).toBe(400);
        expect((await request('DELETE', `/api/events/${event.id}?scope=${scope}${date}`)).statusCode).toBe(400);
      }
      const url = `/api/events/${event.id}?scope=${scope}&occurrenceDate=2026-10-20`;
      expect((await request('PATCH', url, { title: 'Zmiana' }, child)).statusCode).toBe(403);
      expect((await request('DELETE', url, undefined, child)).statusCode).toBe(403);
      expect((await request('PATCH', url, { title: 'Zmiana' }, outsider)).statusCode).toBe(404);
      expect((await request('DELETE', url, undefined, outsider)).statusCode).toBe(404);
    }
    const eventSingle = await create();
    expect(
      (
        await request('PATCH', `/api/events/${eventSingle.id}?scope=this&occurrenceDate=2026-10-13`, {
          title: 'Zmiana',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await request('PATCH', `/api/events/${event.id}?scope=this&occurrenceDate=2026-10-20`, { participantIds: [] }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await request('PATCH', `/api/events/${event.id}?scope=following&occurrenceDate=2026-10-20`, {
          kind: 'single',
          rrule: null,
        })
      ).statusCode,
    ).toBe(400);
  });
});
