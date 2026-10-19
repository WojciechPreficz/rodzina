// @vitest-environment node
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../db/client.js';
import { loadConfig } from '../config.js';
import { backupDatabase } from './backup-db.js';

describe('SQLite backup', () => {
  let directory: string;
  let database: ReturnType<typeof createDatabase>;
  const connections: ReturnType<typeof createDatabase>[] = [];
  const connect = (filename: string) => {
    const connection = createDatabase(loadConfig({ RODZINA_DATABASE_PATH: filename }));
    connections.push(connection);
    return connection;
  };
  const snapshot = (file: string) => {
    const copy = connect(file);
    expect(copy.sqlite.pragma('integrity_check', { simple: true })).toBe('ok');
    const rows = copy.sqlite.prepare('SELECT title FROM entries ORDER BY rowid').all();
    copy.sqlite.close();
    return rows;
  };
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'rodzina-backup-'));
    database = connect(path.join(directory, 'source.db'));
    database.sqlite.exec("CREATE TABLE entries (title TEXT); INSERT INTO entries VALUES ('Pierwszy wpis')");
  });
  afterEach(() => {
    for (const connection of connections.splice(0)) {
      if (connection.sqlite.open) connection.sqlite.close();
    }
    rmSync(directory, { recursive: true, force: true });
  });

  it('creates a standalone consistent snapshot from an open WAL database using the Warsaw date', () => {
    const result = backupDatabase(database, path.join(directory, 'backups'), Date.parse('2026-10-16T22:30:00Z'));
    expect(path.basename(result.file)).toBe('rodzina-2026-10-17.db');
    expect(result.removed).toBe(0);
    expect(snapshot(result.file)).toEqual([{ title: 'Pierwszy wpis' }]);
    database.sqlite.exec("INSERT INTO entries VALUES ('Późniejszy wpis')");
    expect(snapshot(result.file)).toEqual([{ title: 'Pierwszy wpis' }]);
  });

  it('replaces the daily copy on a rerun after completing the new snapshot', () => {
    const backups = path.join(directory, 'backups');
    const now = Date.parse('2026-10-16T10:00:00Z');
    backupDatabase(database, backups, now);
    database.sqlite.exec("INSERT INTO entries VALUES ('Drugi wpis')");
    const result = backupDatabase(database, backups, now);
    expect(snapshot(result.file)).toEqual([{ title: 'Pierwszy wpis' }, { title: 'Drugi wpis' }]);
    expect(readdirSync(backups)).toEqual(['rodzina-2026-10-16.db']);
  });

  it('keeps the 14 latest daily copies by date and leaves unrelated entries untouched', () => {
    const backups = path.join(directory, 'backups');
    mkdirSync(backups);
    writeFileSync(path.join(backups, 'notes.txt'), 'keep');
    writeFileSync(path.join(backups, 'other.db'), 'keep');
    writeFileSync(path.join(backups, '.rodzina-incomplete.tmp'), 'keep');
    mkdirSync(path.join(backups, 'rodzina-2020-01-01.db'));
    for (let day = 1; day <= 16; day++) {
      backupDatabase(database, backups, Date.UTC(2026, 9, day, 12));
    }
    const files = readdirSync(backups, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^rodzina-.*\.db$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    expect(files).toEqual(Array.from({ length: 14 }, (_, i) => `rodzina-2026-10-${String(i + 3).padStart(2, '0')}.db`));
    expect(readdirSync(backups)).toEqual(
      expect.arrayContaining(['notes.txt', 'other.db', '.rodzina-incomplete.tmp', 'rodzina-2020-01-01.db']),
    );
    expect(snapshot(path.join(backups, files.at(-1)!))).toEqual([{ title: 'Pierwszy wpis' }]);
  });

  it('preserves the previous copy and skips rotation when VACUUM fails', () => {
    const backups = path.join(directory, 'backups');
    const now = Date.parse('2026-10-16T10:00:00Z');
    const result = backupDatabase(database, backups, now);
    writeFileSync(path.join(backups, 'rodzina-2020-01-01.db'), 'old');
    database.sqlite.exec('BEGIN');
    try {
      expect(() => backupDatabase(database, backups, now)).toThrow();
    } finally {
      database.sqlite.exec('ROLLBACK');
    }
    expect(snapshot(result.file)).toEqual([{ title: 'Pierwszy wpis' }]);
    expect(readdirSync(backups).sort()).toEqual(['rodzina-2020-01-01.db', 'rodzina-2026-10-16.db']);
  });
});
