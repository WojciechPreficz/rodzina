// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it } from 'vitest';
import { contactGroupSchema } from '@rodzina/shared';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../db/client.js';
import * as schema from '../../db/schema.js';

it('seeds existing families with UUID groups, preserves data and can run again', () => {
  const migrationsFolder = path.resolve('apps/api/drizzle');
  const previous = mkdtempSync(path.join(tmpdir(), 'rodzina-before-contacts-'));
  const database = createDatabase(loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' }));
  try {
    const journal = JSON.parse(readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 23);
    mkdirSync(path.join(previous, 'meta'));
    writeFileSync(path.join(previous, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries)
      copyFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), path.join(previous, `${entry.tag}.sql`));
    migrate(database.db, { migrationsFolder: previous });
    const familyId = randomUUID();
    const emptyFamily = randomUUID();
    const userId = randomUUID();
    database.db
      .insert(schema.families)
      .values([
        { id: familyId, name: 'Rodzina', joinCode: 'ABC123', createdAt: 1 },
        { id: emptyFamily, name: 'Bez domowników', joinCode: 'ABC456', createdAt: 1 },
      ])
      .run();
    database.db
      .insert(schema.users)
      .values({ id: userId, familyId, displayName: 'Anna', role: 'admin', createdAt: 1, updatedAt: 1 })
      .run();
    database.db.insert(schema.sessions).values({ id: 'session', userId, expiresAt: 9999999999999, createdAt: 1 }).run();
    database.db
      .insert(schema.documents)
      .values({
        id: randomUUID(),
        familyId,
        type: 'passport',
        label: 'Paszport',
        expiresOn: '2028-01-01',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    const tables = ['families', 'users', 'sessions', 'documents'];
    const before = tables.map((table) => database.sqlite.prepare(`SELECT * FROM ${table}`).all());
    migrate(database.db, { migrationsFolder });
    const groups = database.db.select().from(schema.contactGroups).all();
    expect(groups).toHaveLength(8);
    for (const id of [familyId, emptyFamily]) {
      const own = groups.filter((group) => group.familyId === id);
      expect(own.map((group) => group.name).sort()).toEqual(['Inne', 'Praca', 'Rodzina', 'Znajomi']);
      expect(own.filter((group) => group.isDefault).map((group) => group.name)).toEqual(['Inne']);
      for (const group of own) {
        expect(contactGroupSchema.safeParse(group).success).toBe(true);
        expect(group.createdAt).toBeGreaterThan(1);
        expect(group.createdBy).toBe(id === familyId ? userId : null);
      }
    }
    expect(new Set(groups.map((group) => group.id)).size).toBe(8);
    migrate(database.db, { migrationsFolder });
    expect(database.db.select().from(schema.contactGroups).all()).toEqual(groups);
    expect(tables.map((table) => database.sqlite.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
    const ownGroup = groups.find((group) => group.familyId === familyId)!;
    const foreignGroup = groups.find((group) => group.familyId === emptyFamily)!;
    const contact = {
      id: randomUUID(),
      familyId,
      name: 'Anna',
      groupId: ownGroup.id,
      createdBy: userId,
      createdAt: 1,
      updatedAt: 1,
    };
    database.db.insert(schema.contacts).values(contact).run();
    expect(() =>
      database.db
        .insert(schema.contacts)
        .values({ ...contact, id: randomUUID(), groupId: foreignGroup.id })
        .run(),
    ).toThrow();
    expect(() =>
      database.db.delete(schema.contactGroups).where(eq(schema.contactGroups.id, ownGroup.id)).run(),
    ).toThrow();
    expect(() =>
      database.db
        .insert(schema.contactGroups)
        .values({ id: randomUUID(), familyId, name: 'Inna', isDefault: true, createdAt: 1, updatedAt: 1 })
        .run(),
    ).toThrow();
    database.db.delete(schema.users).where(eq(schema.users.id, userId)).run();
    expect(database.db.select().from(schema.contacts).get()).toMatchObject({ ...contact, createdBy: null });
    expect(
      database.db
        .select()
        .from(schema.contactGroups)
        .all()
        .every((group) => group.createdBy === null),
    ).toBe(true);
    database.db.delete(schema.families).where(eq(schema.families.id, familyId)).run();
    expect(database.db.select().from(schema.contacts).all()).toEqual([]);
    expect(database.db.select().from(schema.contactGroups).all()).toHaveLength(4);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally {
    database.sqlite.close();
    rmSync(previous, { recursive: true, force: true });
  }
});
