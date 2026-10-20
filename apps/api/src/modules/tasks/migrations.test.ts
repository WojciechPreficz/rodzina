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

it('adds task tables without changing existing family, session, calendar, reminder or shopping data', () => {
  const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');
  const oldMigrations = mkdtempSync(path.join(tmpdir(), 'rodzina-before-tasks-'));
  const database = createDatabase(loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' }));
  try {
    const journal = JSON.parse(readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 16);
    mkdirSync(path.join(oldMigrations, 'meta'));
    writeFileSync(path.join(oldMigrations, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries)
      copyFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), path.join(oldMigrations, `${entry.tag}.sql`));
    migrate(database.db, { migrationsFolder: oldMigrations });
    const familyId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const listId = crypto.randomUUID();
    database.db
      .insert(schema.families)
      .values({ id: familyId, name: 'Rodzina', joinCode: 'ABC123', createdAt: 1 })
      .run();
    database.db
      .insert(schema.users)
      .values({ id: userId, familyId, displayName: 'Anna', role: 'admin', createdAt: 1, updatedAt: 1 })
      .run();
    database.db.insert(schema.sessions).values({ id: 'session', userId, createdAt: 1, expiresAt: 9999999999999 }).run();
    database.db
      .insert(schema.events)
      .values({
        id: eventId,
        familyId,
        title: 'Termin',
        kind: 'single',
        datePrecision: 'day',
        startDate: '2028-05-01',
        createdBy: userId,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
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
        createdBy: userId,
      })
      .run();
    database.db
      .insert(schema.shoppingLists)
      .values({
        id: listId,
        familyId,
        name: 'Zakupy',
        createdBy: userId,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    database.db
      .insert(schema.shoppingItems)
      .values({
        id: crypto.randomUUID(),
        listId,
        name: 'Mleko',
        createdBy: userId,
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const existingData = () => ({
      families: database.db.select().from(schema.families).all(),
      users: database.db.select().from(schema.users).all(),
      sessions: database.db.select().from(schema.sessions).all(),
      events: database.db.select().from(schema.events).all(),
      reminders: database.db.select().from(schema.reminders).all(),
      lists: database.db.select().from(schema.shoppingLists).all(),
      items: database.db.select().from(schema.shoppingItems).all(),
    });
    const before = existingData();
    migrate(database.db, { migrationsFolder });
    expect(existingData()).toEqual(before);
    expect(database.db.select().from(schema.taskLists).all()).toEqual([]);
    const taskListId = crypto.randomUUID();
    database.db
      .insert(schema.taskLists)
      .values({
        id: taskListId,
        familyId,
        ownerId: userId,
        name: 'Moje zadania',
        isDefault: true,
        createdAt: 2,
        updatedAt: 2,
      })
      .run();
    database.db
      .insert(schema.tasks)
      .values({
        id: crypto.randomUUID(),
        listId: taskListId,
        title: 'Nowe zadanie',
        createdBy: userId,
        createdAt: 2,
        updatedAt: 2,
      })
      .run();
    migrate(database.db, { migrationsFolder });
    expect(existingData()).toEqual(before);
    expect(database.db.select().from(schema.tasks).all()).toHaveLength(1);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally {
    database.sqlite.close();
    rmSync(oldMigrations, { recursive: true, force: true });
  }
});
