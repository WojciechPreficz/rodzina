// @vitest-environment node
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { and, asc, eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { taskSnapshotResponseSchema } from '@rodzina/shared';
import { buildApp } from '../../app.js';
import { hashToken } from '../../auth.js';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../db/client.js';
import * as s from '../../db/schema.js';
import { createEventRepository } from '../events/repository.js';
import { createReminderRepository } from '../reminders/repository.js';

let database: ReturnType<typeof createDatabase>;
let app: Awaited<ReturnType<typeof buildApp>>;
let familyId: string;
let userId: string;
let cookie: string;
const reports: unknown[] = [];
beforeEach(async () => {
  const config = loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' });
  database = createDatabase(config);
  migrate(database.db, {
    migrationsFolder: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle'),
  });
  app = await buildApp(config, database);
  familyId = crypto.randomUUID();
  userId = crypto.randomUUID();
  database.db.insert(s.families).values({ id: familyId, name: 'Test', joinCode: familyId, createdAt: 1 }).run();
  database.db
    .insert(s.users)
    .values({ id: userId, familyId, displayName: 'Test', role: 'admin', createdAt: 1, updatedAt: 1 })
    .run();
  const token = crypto.randomUUID();
  cookie = `sid=${token}`;
  database.db
    .insert(s.sessions)
    .values({ id: hashToken(token), userId, expiresAt: Date.UTC(2100, 0, 1), createdAt: 1 })
    .run();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
  database.sqlite.close();
});
async function get(url: string, delay = 0) {
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  const response = await app.inject({ method: 'GET', url, headers: { cookie } });
  expect(response.statusCode, response.body).toBe(200);
  return response;
}
it.each([1, 10, 30])(
  'measures legacy and snapshot reads for %i lists on identical data',
  async (count) => {
    const initial = (await get('/api/tasks/lists')).json().lists[0].id as string;
    for (let i = 0; i < count; i++) {
      const listId = i === 0 ? initial : crypto.randomUUID();
      if (i)
        database.db
          .insert(s.taskLists)
          .values({ id: listId, familyId, ownerId: userId, name: `Lista ${i}`, createdAt: 1, updatedAt: 1 })
          .run();
      for (let j = 0; j < 10; j++)
        database.db
          .insert(s.tasks)
          .values({
            id: crypto.randomUUID(),
            listId,
            title: `Zadanie ${j}`,
            createdBy: userId,
            createdAt: 1,
            updatedAt: 1,
          })
          .run();
    }
    for (const delay of [0, 5]) {
      for (const mode of ['legacy', 'snapshot'] as const) {
        const samples: number[] = [];
        let bytes = 0;
        let sql = 0;
        let requests = 0;
        for (let sample = 0; sample < 5; sample++) {
          const spy = vi.spyOn(database.sqlite, 'prepare');
          const start = performance.now();
          const responses = [await get('/api/auth/me', delay)];
          if (mode === 'legacy') {
            const lists = await get('/api/tasks/lists', delay);
            responses.push(lists);
            for (const list of lists.json().lists)
              responses.push(await get(`/api/tasks/lists/${list.id}/tasks?status=all`, delay));
          } else {
            const response = await get('/api/tasks/snapshot', delay);
            const snapshot = taskSnapshotResponseSchema.parse(response.json());
            expect(snapshot.lists).toHaveLength(count);
            expect(Object.values(snapshot.items).flat()).toHaveLength(count * 10);
            responses.push(response);
          }
          samples.push(performance.now() - start);
          bytes = responses.reduce((total, response) => total + Buffer.byteLength(response.body), 0);
          sql = spy.mock.calls.filter(([query]) => /^select/i.test(query)).length;
          requests = responses.length;
          spy.mockRestore();
        }
        reports.push({
          kind: 'tasks',
          count,
          delayMs: delay,
          mode,
          requests,
          sql,
          bytes,
          medianMs: Number(samples.sort((a, b) => a - b)[2]!.toFixed(2)),
        });
      }
    }
    mkdirSync('coverage', { recursive: true });
    writeFileSync('coverage/sync-performance.json', JSON.stringify(reports, null, 2));
  },
  30000,
);

it.each([1, 10, 401])('batches event relations for %i events and preserves the legacy result', (count) => {
  const db = database.db;
  for (let i = 0; i < count; i++) {
    const id = crypto.randomUUID();
    db.insert(s.events)
      .values({
        id,
        familyId,
        title: `Wydarzenie ${i}`,
        kind: 'single',
        datePrecision: 'day',
        startDate: '2028-01-01',
        createdBy: userId,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    db.insert(s.eventParticipants).values({ eventId: id, userId }).run();
    db.insert(s.eventExceptions)
      .values({ id: crypto.randomUUID(), eventId: id, originalDate: '2028-01-01', isCancelled: true })
      .run();
  }
  const repository = createEventRepository(database);
  const reminderRepository = createReminderRepository(database);
  // The former list implementation: one base SELECT, three relation SELECTs per event.
  const legacy = () =>
    db
      .select()
      .from(s.events)
      .where(eq(s.events.familyId, familyId))
      .all()
      .map((event) => ({
        ...event,
        participants: db
          .select({ id: s.users.id, displayName: s.users.displayName, color: s.users.color })
          .from(s.eventParticipants)
          .innerJoin(s.users, eq(s.eventParticipants.userId, s.users.id))
          .where(and(eq(s.eventParticipants.eventId, event.id), eq(s.users.familyId, familyId)))
          .orderBy(asc(s.users.createdAt), asc(s.users.id))
          .all(),
        reminders: reminderRepository.list(familyId, event.id),
        exceptions: db
          .select({ exception: s.eventExceptions })
          .from(s.eventExceptions)
          .innerJoin(s.events, eq(s.events.id, s.eventExceptions.eventId))
          .where(and(eq(s.events.familyId, familyId), eq(s.events.id, event.id)))
          .orderBy(asc(s.eventExceptions.originalDate))
          .all()
          .map((row) => row.exception),
      }));
  const expected = legacy();
  for (const mode of ['legacy', 'batched'] as const) {
    const spy = vi.spyOn(database.sqlite, 'prepare');
    const start = performance.now();
    const result = mode === 'legacy' ? legacy() : repository.list(familyId);
    const elapsed = performance.now() - start;
    const sql = spy.mock.calls.filter(([query]) => /^select/i.test(query)).length;
    spy.mockRestore();
    expect(result).toEqual(expected);
    expect(sql).toBe(mode === 'legacy' ? 1 + 3 * count : 1 + 3 * Math.ceil(count / 400));
    reports.push({
      kind: 'events',
      count,
      mode,
      sql,
      bytes: Buffer.byteLength(JSON.stringify(result)),
      elapsedMs: Number(elapsed.toFixed(2)),
    });
  }
  mkdirSync('coverage', { recursive: true });
  writeFileSync('coverage/sync-performance.json', JSON.stringify(reports, null, 2));
});
