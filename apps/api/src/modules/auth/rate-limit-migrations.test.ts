// @vitest-environment node
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it } from 'vitest';
import { createDatabase } from '../../db/client.js';
import { loadConfig } from '../../config.js';
import { authRateLimits, families, sessions, users } from '../../db/schema.js';

it('upgrades an existing database without changing auth data and preserves counters on a repeated migration', () => {
  const migrationsFolder = path.resolve('apps/api/drizzle');
  const previous = mkdtempSync(path.join(tmpdir(), 'rodzina-before-auth-limits-'));
  const database = createDatabase(loadConfig({ RODZINA_DATABASE_PATH: ':memory:' }));
  try {
    const journal = JSON.parse(readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 24);
    mkdirSync(path.join(previous, 'meta'));
    writeFileSync(path.join(previous, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries) {
      copyFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), path.join(previous, `${entry.tag}.sql`));
    }
    migrate(database.db, { migrationsFolder: previous });
    database.db.insert(families).values({ id: 'family', name: 'Family', joinCode: 'ABC123', createdAt: 1 }).run();
    database.db
      .insert(users)
      .values({ id: 'user', familyId: 'family', displayName: 'Admin', createdAt: 1, updatedAt: 1 })
      .run();
    database.db
      .insert(sessions)
      .values({ id: 'session', userId: 'user', createdAt: 1, expiresAt: 9999999999999 })
      .run();
    const before = [
      database.db.select().from(families).all(),
      database.db.select().from(users).all(),
      database.db.select().from(sessions).all(),
    ];
    migrate(database.db, { migrationsFolder });
    expect(database.db.select().from(authRateLimits).all()).toEqual([]);
    const counter = { scopeKey: 'key', count: 10, expiresAt: 9999999999999 };
    database.db.insert(authRateLimits).values(counter).run();
    migrate(database.db, { migrationsFolder });
    expect(database.db.select().from(authRateLimits).all()).toEqual([counter]);
    expect([
      database.db.select().from(families).all(),
      database.db.select().from(users).all(),
      database.db.select().from(sessions).all(),
    ]).toEqual(before);
    expect(database.sqlite.prepare("PRAGMA index_info('auth_rate_limits_expiry_idx')").all()).toMatchObject([
      { name: 'expires_at' },
    ]);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally {
    database.sqlite.close();
    rmSync(previous, { recursive: true, force: true });
  }
});
