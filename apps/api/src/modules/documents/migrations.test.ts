// @vitest-environment node
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../db/client.js';

it('upgrades the existing database without losing data and safely runs again', () => {
  const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle');
  const previous = mkdtempSync(path.join(tmpdir(), 'rodzina-before-documents-'));
  const database = createDatabase(loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' }));
  try {
    const journal = JSON.parse(readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 20);
    mkdirSync(path.join(previous, 'meta'));
    writeFileSync(path.join(previous, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries)
      copyFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), path.join(previous, `${entry.tag}.sql`));
    migrate(database.db, { migrationsFolder: previous });
    database.sqlite.exec(`
      INSERT INTO families (id, name, join_code, created_at) VALUES ('family', 'Rodzina', 'ABC123', 1);
      INSERT INTO users (id, family_id, display_name, role, created_at, updated_at)
        VALUES ('adult', 'family', 'Anna', 'admin', 1, 1);
      INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('session', 'adult', 9999999999999, 1);
      INSERT INTO events (id, family_id, title, start_date, date_precision, kind, created_at, updated_at)
        VALUES ('event', 'family', 'Termin', '2028-01-01', 'day', 'single', 1, 1);
      INSERT INTO reminders (id, family_id, event_id, type, offset_value, offset_unit, audience)
        VALUES ('reminder', 'family', 'event', 'offset', 1, 'day', 'family');
    `);
    const existingTables = ['families', 'users', 'sessions', 'events', 'reminders'];
    const before = existingTables.map((table) => database.sqlite.prepare(`SELECT * FROM ${table}`).all());
    migrate(database.db, { migrationsFolder });
    database.sqlite.exec(`INSERT INTO documents (id, family_id, type, label, holder_user_id, expires_on,
      created_by, created_at, updated_at)
      VALUES ('document', 'family', 'passport', 'Paszport', 'adult', '2028-01-01', 'adult', 1, 1)`);
    migrate(database.db, { migrationsFolder });
    expect(existingTables.map((table) => database.sqlite.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
    expect(database.sqlite.prepare('SELECT * FROM documents').all()).toHaveLength(1);
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
    const columns = database.sqlite.pragma('table_info(documents)') as { name: string }[];
    expect(columns.map((column) => column.name)).not.toContain('number');
  } finally {
    database.sqlite.close();
    rmSync(previous, { recursive: true, force: true });
  }
});
