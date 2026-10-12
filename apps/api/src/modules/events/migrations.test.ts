// @vitest-environment node
import crypto from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../db/client.js';
import * as schema from '../../db/schema.js';

it('upgrades the existing auth database without recreating tables or losing data', () => {
  const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');
  const oldMigrations = mkdtempSync(path.join(tmpdir(), 'rodzina-auth-migrations-'));
  const database = createDatabase(loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' }));
  try {
    const journal = JSON.parse(readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 10);
    mkdirSync(path.join(oldMigrations, 'meta'));
    writeFileSync(path.join(oldMigrations, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries)
      copyFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), path.join(oldMigrations, `${entry.tag}.sql`));
    migrate(database.db, { migrationsFolder: oldMigrations });
    const familyId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    database.db
      .insert(schema.families)
      .values({ id: familyId, name: 'Istniejąca rodzina', joinCode: 'ABC123', createdAt: 1 })
      .run();
    database.db
      .insert(schema.users)
      .values({ id: userId, familyId, displayName: 'Anna', role: 'admin', createdAt: 1, updatedAt: 1 })
      .run();
    const before = database.db.select().from(schema.users).all();

    migrate(database.db, { migrationsFolder });
    expect(database.db.select().from(schema.users).all()).toEqual(before);
    database.db
      .insert(schema.events)
      .values({
        id: crypto.randomUUID(),
        familyId,
        createdBy: userId,
        title: 'Nowe wydarzenie',
        startDate: '2028-05-01',
        datePrecision: 'month',
        kind: 'distant',
        createdAt: 2,
        updatedAt: 2,
      })
      .run();
    migrate(database.db, { migrationsFolder });
    expect(database.db.select().from(schema.events).all()).toHaveLength(1);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally {
    database.sqlite.close();
    rmSync(oldMigrations, { recursive: true, force: true });
  }
});

it('adds reminders to an existing calendar without changing its events', () => {
  const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');
  const oldMigrations = mkdtempSync(path.join(tmpdir(), 'rodzina-calendar-migrations-'));
  const database = createDatabase(loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' }));
  try {
    const journal = JSON.parse(readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 10);
    mkdirSync(path.join(oldMigrations, 'meta'));
    writeFileSync(path.join(oldMigrations, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries)
      copyFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), path.join(oldMigrations, `${entry.tag}.sql`));
    migrate(database.db, { migrationsFolder: oldMigrations });
    const familyId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    database.db
      .insert(schema.families)
      .values({ id: familyId, name: 'Rodzina', joinCode: 'ABC123', createdAt: 1 })
      .run();
    database.db
      .insert(schema.events)
      .values({
        id: eventId,
        familyId,
        title: 'Termin',
        startDate: '2028-05-01',
        datePrecision: 'day',
        kind: 'single',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const before = database.db.select().from(schema.events).all();
    migrate(database.db, { migrationsFolder });
    expect(database.db.select().from(schema.events).all()).toEqual(before);
    database.db
      .insert(schema.reminders)
      .values({
        id: crypto.randomUUID(),
        familyId,
        eventId,
        type: 'offset',
        offsetValue: 1,
        offsetUnit: 'day',
        audience: 'family',
      })
      .run();
    migrate(database.db, { migrationsFolder });
    expect(database.db.select().from(schema.reminders).all()).toHaveLength(1);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally {
    database.sqlite.close();
    rmSync(oldMigrations, { recursive: true, force: true });
  }
});
