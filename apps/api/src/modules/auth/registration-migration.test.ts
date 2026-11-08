// @vitest-environment node
import { readFileSync } from 'node:fs';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it } from 'vitest';
import { createDatabase } from '../../db/client.js';
import { loadConfig } from '../../config.js';
import { families, pendingRegistrations, sessions, users } from '../../db/schema.js';
import { hashPassword, hashToken } from '../../auth.js';
import { buildApp } from '../../app.js';

it('adds pending requests without modifying existing families, passwords or sessions', async () => {
  const config = loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' });
  const database = createDatabase(config);
  const app = await buildApp(config, database);
  try {
    // Build the schema as it existed immediately before this migration.
    const migrations = readMigrationFiles({ migrationsFolder: './apps/api/drizzle' });
    for (const migration of migrations.slice(0, -1)) for (const sql of migration.sql) database.sqlite.exec(sql);
    const now = Date.now();
    database.db
      .insert(families)
      .values({ id: 'family', name: 'Stara rodzina', joinCode: 'ABC123', createdAt: now })
      .run();
    database.db
      .insert(users)
      .values({
        id: 'admin',
        familyId: 'family',
        displayName: 'Admin',
        email: 'old@example.com',
        passwordHash: await hashPassword('oldPassword'),
        role: 'admin',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    database.db
      .insert(sessions)
      .values({ id: hashToken('old-session'), userId: 'admin', createdAt: now, expiresAt: now + 60_000 })
      .run();
    const before = [
      database.db.select().from(families).all(),
      database.db.select().from(users).all(),
      database.db.select().from(sessions).all(),
    ];
    database.sqlite.exec(readFileSync('apps/api/drizzle/0034_pending_registrations.sql', 'utf8'));
    expect([
      database.db.select().from(families).all(),
      database.db.select().from(users).all(),
      database.db.select().from(sessions).all(),
    ]).toEqual(before);
    expect(database.db.select().from(pendingRegistrations).all()).toEqual([]);
    expect((await app.inject({ url: '/api/auth/me', headers: { cookie: 'sid=old-session' } })).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          headers: { origin: 'http://localhost:3000', host: 'localhost:3000' },
          payload: { email: 'old@example.com', password: 'oldPassword' },
        })
      ).statusCode,
    ).toBe(200);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally {
    await app.close();
    database.sqlite.close();
  }
});

it('supports both fresh migration and repeated migration without pending account creation', () => {
  const database = createDatabase(loadConfig({ RODZINA_DATABASE_PATH: ':memory:' }));
  try {
    migrate(database.db, { migrationsFolder: './apps/api/drizzle' });
    migrate(database.db, { migrationsFolder: './apps/api/drizzle' });
    expect(database.db.select().from(pendingRegistrations).all()).toEqual([]);
    expect(database.db.select().from(families).all()).toEqual([]);
  } finally {
    database.sqlite.close();
  }
});
