// @vitest-environment node
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { backupDatabase } from '../jobs/backup-db.js';
import { createDatabase } from './client.js';
import { assertMigrationsApplied } from './migrations.js';

const migrationsFolder = path.resolve('apps/api/drizzle');
const connect = (filename: string) => createDatabase(loadConfig({ RODZINA_DATABASE_PATH: filename }));

it('adds lookup indexes to a backup of the previous schema and preserves existing rows', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'rodzina-index-migration-'));
  const previous = path.join(directory, 'drizzle');
  const source = connect(path.join(directory, 'source.db'));
  let copy: ReturnType<typeof connect> | undefined;
  try {
    const journal = JSON.parse(readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 35);
    mkdirSync(path.join(previous, 'meta'), { recursive: true });
    writeFileSync(path.join(previous, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries) {
      copyFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), path.join(previous, `${entry.tag}.sql`));
    }
    migrate(source.db, { migrationsFolder: previous });
    source.sqlite.exec(`
      INSERT INTO families (id, name, join_code, created_at) VALUES ('family', 'Family', 'ABC123', 1);
      INSERT INTO users (id, family_id, display_name, created_at, updated_at) VALUES ('user', 'family', 'User', 1, 1);
      INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ('session', 'user', 1, 2000);
      INSERT INTO task_lists (id, family_id, owner_id, name, created_at, updated_at)
        VALUES ('list', 'family', 'user', 'List', 1, 1);
      INSERT INTO tasks (id, list_id, title, created_by, created_at, updated_at)
        VALUES ('task', 'list', 'Task', 'user', 1, 1);
      INSERT INTO reminders (id, family_id, task_id, type, audience, created_by)
        VALUES ('reminder', 'family', 'task', 'absolute', 'owner', 'user');
      INSERT INTO event_import_operations (family_id, user_id, id, fingerprint, event_id)
        VALUES ('family', 'user', 'import', 'fingerprint', 'deleted-event');
    `);
    const { file } = backupDatabase(source, path.join(directory, 'backup'));
    copy = connect(file);

    // Use SQLite's clock for both bounds, since its resolution can differ from Date.now().
    const clock = copy.sqlite.prepare<[], number>("SELECT CAST(unixepoch('subsec') * 1000 AS INTEGER)").pluck();
    const before = clock.get()!;
    migrate(copy.db, { migrationsFolder });
    const after = clock.get()!;
    migrate(copy.db, { migrationsFolder });
    assertMigrationsApplied(copy, migrationsFolder);
    const readRows = (connection: ReturnType<typeof connect>, table: string) =>
      connection.sqlite.prepare(`SELECT * FROM ${table}`).all();
    for (const table of ['families', 'users', 'sessions', 'task_lists', 'tasks', 'reminders']) {
      expect(readRows(copy, table)).toEqual(readRows(source, table));
    }
    const imported = readRows(copy, 'event_import_operations') as { created_at: number }[];
    const [legacy] = readRows(source, 'event_import_operations') as object[];
    expect(imported).toEqual([{ ...legacy, created_at: expect.any(Number) }]);
    expect(imported[0]!.created_at).toBeGreaterThanOrEqual(before);
    expect(imported[0]!.created_at).toBeLessThanOrEqual(after);

    for (const [query, index] of [
      ['SELECT id FROM users WHERE family_id = ?', 'users_family_idx'],
      ['SELECT id FROM reminders WHERE task_id = ?', 'reminders_task_idx'],
      ['DELETE FROM sessions WHERE expires_at <= ?', 'sessions_expiry_idx'],
      ['DELETE FROM invitations WHERE expires_at <= ?', 'invitations_expiry_idx'],
      ['DELETE FROM password_resets WHERE expires_at <= ?', 'password_resets_expiry_idx'],
      ['DELETE FROM event_import_operations WHERE created_at < ?', 'event_import_operations_created_at_idx'],
      ['SELECT id FROM tasks WHERE created_by = ?', 'tasks_created_by_idx'],
    ]) {
      const plan = copy.sqlite.prepare(`EXPLAIN QUERY PLAN ${query}`).all(1) as { detail: string }[];
      expect(plan[0]?.detail).toContain(index);
    }
    expect(copy.sqlite.pragma('foreign_key_check')).toEqual([]);
  } finally {
    copy?.sqlite.close();
    source.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
