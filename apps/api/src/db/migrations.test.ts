// @vitest-environment node
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { loadConfig } from '../config.js';
import { createDatabase } from './client.js';
import { assertMigrationsApplied } from './migrations.js';

const migrationsFolder = path.resolve('apps/api/drizzle');
const database = () => createDatabase(loadConfig({ RODZINA_DATABASE_PATH: ':memory:' }));
const connections: ReturnType<typeof database>[] = [];
afterEach(() => {
  for (const connection of connections.splice(0)) connection.sqlite.close();
});

it('rejects an empty database without creating the migration journal', () => {
  const connection = database();
  connections.push(connection);
  expect(() => assertMigrationsApplied(connection, migrationsFolder)).toThrow('dist/jobs/migrate-db.js');
  expect(connection.sqlite.prepare('SELECT name FROM sqlite_master').all()).toEqual([]);
});

it('accepts a migrated database without writing, and rejects a missing earlier migration', () => {
  const connection = database();
  connections.push(connection);
  migrate(connection.db, { migrationsFolder });
  connection.sqlite.pragma('query_only = ON');
  expect(() => assertMigrationsApplied(connection, migrationsFolder)).not.toThrow();
  connection.sqlite.pragma('query_only = OFF');
  connection.sqlite.exec(
    'DELETE FROM __drizzle_migrations WHERE created_at = (SELECT MIN(created_at) FROM __drizzle_migrations)',
  );
  expect(() => assertMigrationsApplied(connection, migrationsFolder)).toThrow('Baza wymaga migracji (1)');
});

it('enforces foreign keys and cascades deletes on a fresh application connection', () => {
  const connection = database();
  connections.push(connection);
  expect(connection.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  migrate(connection.db, { migrationsFolder });
  const insertSession = connection.sqlite.prepare(
    "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ('session', 'user', 1, 2000)",
  );
  expect(() => insertSession.run()).toThrow('FOREIGN KEY constraint failed');
  connection.sqlite.exec(`
    INSERT INTO families (id, name, join_code, created_at) VALUES ('family', 'Family', 'ABC123', 1);
    INSERT INTO users (id, family_id, display_name, created_at, updated_at) VALUES ('user', 'family', 'User', 1, 1);
  `);
  insertSession.run();
  connection.sqlite.exec("DELETE FROM families WHERE id = 'family'");
  expect(connection.sqlite.prepare('SELECT id FROM users').all()).toEqual([]);
  expect(connection.sqlite.prepare('SELECT id FROM sessions').all()).toEqual([]);
});
