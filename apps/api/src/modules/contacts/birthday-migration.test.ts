// @vitest-environment node
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it } from 'vitest';
import { loadConfig } from '../../config.js';
import { createDatabase } from '../../db/client.js';

it('preserves existing contacts with no birthday and can repeat migration', () => {
  const migrationsFolder = path.resolve('apps/api/drizzle');
  const previous = mkdtempSync(path.join(tmpdir(), 'rodzina-before-birthdays-'));
  const database = createDatabase(loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' }));
  try {
    const journal = JSON.parse(readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 30);
    mkdirSync(path.join(previous, 'meta'));
    writeFileSync(path.join(previous, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries)
      copyFileSync(path.join(migrationsFolder, `${entry.tag}.sql`), path.join(previous, `${entry.tag}.sql`));
    migrate(database.db, { migrationsFolder: previous });
    database.sqlite.exec(
      "INSERT INTO families (id, name, join_code, created_at) VALUES ('family', 'Rodzina', 'abc', 1)",
    );
    database.sqlite.exec(
      "INSERT INTO contact_groups (id, family_id, name, is_default, created_at, updated_at) VALUES ('group', 'family', 'Inne', 1, 1, 1)",
    );
    database.sqlite.exec(
      "INSERT INTO contacts (id, family_id, group_id, name, phone, created_at, updated_at) VALUES ('contact', 'family', 'group', 'Anna', '123', 1, 1)",
    );
    const before = database.sqlite.prepare('SELECT * FROM contacts').get();
    migrate(database.db, { migrationsFolder });
    expect(database.sqlite.prepare('SELECT * FROM contacts').get()).toEqual({ ...(before as object), birthday: null });
    database.sqlite.prepare('UPDATE contacts SET birthday = ?').run('2000-02-29');
    migrate(database.db, { migrationsFolder });
    expect(database.sqlite.prepare('SELECT birthday FROM contacts').get()).toEqual({ birthday: '2000-02-29' });
  } finally {
    database.sqlite.close();
    rmSync(previous, { recursive: true, force: true });
  }
});
