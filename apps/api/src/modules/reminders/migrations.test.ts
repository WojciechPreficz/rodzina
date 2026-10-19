// @vitest-environment node
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it, vi } from 'vitest';
import { reminderScheduleSchema } from '@rodzina/shared';
import { buildApp } from '../../app.js';
import { hashToken } from '../../auth.js';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../db/client.js';
import * as schema from '../../db/schema.js';
import { readReminderSchedule } from './schedule.js';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');

it('migrates a fresh database without subscriptions and preserves the reminder schema', () => {
  const database = createDatabase(loadConfig({ RODZINA_DATABASE_PATH: ':memory:' }));
  try {
    migrate(database.db, { migrationsFolder });
    migrate(database.db, { migrationsFolder });
    expect(
      database.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'push_subscriptions'").get(),
    ).toBeUndefined();
    expect(database.db.select().from(schema.reminders).all()).toEqual([]);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally {
    database.sqlite.close();
  }
});

it('drops only subscriptions from an existing database and keeps sessions, data and the APK snapshot', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'rodzina-retire-push-'));
  const oldMigrations = path.join(directory, 'old-migrations');
  const config = loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: path.join(directory, 'existing.db') });
  const familyId = randomUUID();
  const userId = randomUUID();
  const eventId = randomUUID();
  let database = createDatabase(config);
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-19T10:00:00Z'));
  try {
    const journal = JSON.parse(readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 12);
    mkdirSync(path.join(oldMigrations, 'meta'), { recursive: true });
    writeFileSync(path.join(oldMigrations, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries)
      copyFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), path.join(oldMigrations, `${entry.tag}.sql`));
    migrate(database.db, { migrationsFolder: oldMigrations });
    database.db
      .insert(schema.families)
      .values({ id: familyId, name: 'Rodzina', joinCode: 'ABC123', createdAt: 1 })
      .run();
    database.db
      .insert(schema.users)
      .values({ id: userId, familyId, displayName: 'Anna', role: 'admin', createdAt: 1, updatedAt: 1 })
      .run();
    database.db
      .insert(schema.sessions)
      .values({ id: hashToken('existing-token'), userId, expiresAt: Date.now() + 86400000, createdAt: 1 })
      .run();
    database.db
      .insert(schema.events)
      .values({
        id: eventId,
        familyId,
        title: 'Basen',
        kind: 'recurring',
        startDate: '2026-10-20',
        startTime: '17:00',
        datePrecision: 'day',
        rrule: 'FREQ=DAILY;COUNT=3',
        createdBy: userId,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    database.db.insert(schema.eventParticipants).values({ eventId, userId }).run();
    database.db
      .insert(schema.eventExceptions)
      .values({
        id: randomUUID(),
        eventId,
        originalDate: '2026-10-21',
        overrideStartDate: '2026-10-22',
        overrideStartTime: '18:00',
      })
      .run();
    for (const audience of ['family', 'user'] as const)
      database.db
        .insert(schema.reminders)
        .values({
          id: randomUUID(),
          familyId,
          eventId,
          type: 'offset',
          offsetValue: 1,
          offsetUnit: 'day',
          audience,
          userId: audience === 'user' ? userId : null,
          createdBy: userId,
          nextFireAt: null,
          lastSentAt: 123,
        })
        .run();
    database.sqlite
      .prepare(
        'INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(randomUUID(), userId, 'https://push.example.com/device', 'key', 'auth', 1);

    const preservedTables = [
      'families',
      'users',
      'sessions',
      'events',
      'event_participants',
      'event_exceptions',
      'reminders',
      'invitations',
      'password_resets',
      'job_runs',
    ];
    const readRows = () =>
      Object.fromEntries(preservedTables.map((name) => [name, database.sqlite.prepare(`SELECT * FROM ${name}`).all()]));
    const before = readRows();
    const snapshot = reminderScheduleSchema.parse(readReminderSchedule(database, familyId, userId));
    expect(snapshot.reminders).toHaveLength(6);
    database.sqlite.close();
    database = createDatabase(config);
    migrate(database.db, { migrationsFolder });
    migrate(database.db, { migrationsFolder });
    expect(readRows()).toEqual(before);
    expect(
      database.sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' ORDER BY name",
        )
        .all(),
    ).toEqual(preservedTables.sort().map((name) => ({ name })));
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
    app = await buildApp(config, database);
    const response = await app.inject({
      method: 'GET',
      url: '/api/reminders/schedule',
      headers: { cookie: 'sid=existing-token' },
    });
    expect(response.statusCode).toBe(200);
    expect(reminderScheduleSchema.parse(response.json())).toEqual(snapshot);
    expect(
      (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: 'sid=existing-token' } })).statusCode,
    ).toBe(200);
  } finally {
    await app?.close();
    database.sqlite.close();
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  }
});
