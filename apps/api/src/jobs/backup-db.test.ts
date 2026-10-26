// @vitest-environment node
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDatabase } from '../db/client.js';
import { loadConfig } from '../config.js';
import * as schema from '../db/schema.js';
import { backupDatabase, deleteExpiredSessions, runBackup } from './backup-db.js';

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
  const seedSessions = (now: number) => {
    database.db
      .insert(schema.families)
      .values({ id: 'family', name: 'Family', joinCode: 'ABCDEF', createdAt: now })
      .run();
    database.db
      .insert(schema.users)
      .values({ id: 'user', familyId: 'family', displayName: 'Admin', createdAt: now, updatedAt: now })
      .run();
    database.db
      .insert(schema.sessions)
      .values([
        { id: 'expired', userId: 'user', createdAt: now - 2000, expiresAt: now - 1 },
        { id: 'boundary', userId: 'user', createdAt: now - 2000, expiresAt: now },
        { id: 'active', userId: 'user', createdAt: now - 2000, expiresAt: now + 60000 },
      ])
      .run();
  };
  const backupConfig = () =>
    loadConfig({
      NODE_ENV: 'test',
      RODZINA_DATABASE_PATH: path.join(directory, 'source.db'),
      RODZINA_BACKUP_DIR: path.join(directory, 'backups'),
    });
  const seedRateLimits = () => {
    database.db
      .insert(schema.authRateLimits)
      .values([
        { scopeKey: 'expired', count: 10, expiresAt: Date.now() - 1000 },
        { scopeKey: 'active', count: 3, expiresAt: Date.now() + 60000 },
      ])
      .run();
  };
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'rodzina-backup-'));
    database = connect(path.join(directory, 'source.db'));
    migrate(database.db, { migrationsFolder: './apps/api/drizzle' });
    database.sqlite.exec("CREATE TABLE entries (title TEXT); INSERT INTO entries VALUES ('Pierwszy wpis')");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const connection of connections.splice(0)) {
      if (connection.sqlite.open) connection.sqlite.close();
    }
    rmSync(directory, { recursive: true, force: true });
  });

  it('deletes only expired sessions including the exact expiration boundary', () => {
    const now = Date.now();
    seedSessions(now);
    expect(deleteExpiredSessions(database, now)).toBe(2);
    expect(
      database.db
        .select()
        .from(schema.sessions)
        .all()
        .map((row) => row.id),
    ).toEqual(['active']);
    expect(deleteExpiredSessions(database, now)).toBe(0);
    expect(database.db.select().from(schema.users).all()).toHaveLength(1);
  });

  it('cleans sessions after the backup while keeping them in the snapshot', () => {
    seedSessions(Date.now() - 1000);
    seedRateLimits();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    runBackup(backupConfig());
    expect(
      database.db
        .select()
        .from(schema.sessions)
        .all()
        .map((row) => row.id),
    ).toEqual(['active']);
    const file = readdirSync(backupConfig().RODZINA_BACKUP_DIR).find((name) => name.endsWith('.db'))!;
    const copy = connect(path.join(backupConfig().RODZINA_BACKUP_DIR, file));
    expect(copy.db.select().from(schema.sessions).all()).toHaveLength(3);
    expect(copy.db.select().from(schema.authRateLimits).all()).toHaveLength(2);
    expect(
      database.db
        .select()
        .from(schema.authRateLimits)
        .all()
        .map((row) => row.scopeKey),
    ).toEqual(['active']);
    expect(log.mock.calls.map(([value]) => JSON.parse(value).event)).toEqual([
      'backup_finished',
      'expired_sessions_deleted',
      'expired_auth_rate_limits_deleted',
    ]);
  });

  it('logs a cleanup failure without failing or removing the completed backup', () => {
    seedSessions(Date.now() - 1000);
    seedRateLimits();
    database.sqlite.exec(
      "CREATE TRIGGER reject_session_cleanup BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'test failure'); END",
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => runBackup(backupConfig())).not.toThrow();
    expect(JSON.parse(error.mock.calls[0]![0]).event).toBe('session_cleanup_failed');
    expect(database.db.select().from(schema.sessions).all()).toHaveLength(3);
    expect(
      database.db
        .select()
        .from(schema.authRateLimits)
        .all()
        .map((row) => row.scopeKey),
    ).toEqual(['active']);
    const file = readdirSync(backupConfig().RODZINA_BACKUP_DIR).find((name) => name.endsWith('.db'))!;
    snapshot(path.join(backupConfig().RODZINA_BACKUP_DIR, file));
  });

  it('does not clean sessions when the backup fails', () => {
    seedSessions(Date.now() - 1000);
    seedRateLimits();
    writeFileSync(backupConfig().RODZINA_BACKUP_DIR, 'blocked');
    expect(() => runBackup(backupConfig())).toThrow();
    expect(database.db.select().from(schema.sessions).all()).toHaveLength(3);
    expect(database.db.select().from(schema.authRateLimits).all()).toHaveLength(2);
  });

  it('logs a rate limit cleanup failure without failing the backup or session cleanup', () => {
    seedSessions(Date.now() - 1000);
    seedRateLimits();
    database.sqlite.exec(
      "CREATE TRIGGER reject_limit_cleanup BEFORE DELETE ON auth_rate_limits BEGIN SELECT RAISE(ABORT, 'test failure'); END",
    );
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => runBackup(backupConfig())).not.toThrow();
    expect(JSON.parse(error.mock.calls[0]![0]).event).toBe('auth_rate_limit_cleanup_failed');
    expect(database.db.select().from(schema.authRateLimits).all()).toHaveLength(2);
    expect(
      database.db
        .select()
        .from(schema.sessions)
        .all()
        .map((row) => row.id),
    ).toEqual(['active']);
    const file = readdirSync(backupConfig().RODZINA_BACKUP_DIR).find((name) => name.endsWith('.db'))!;
    snapshot(path.join(backupConfig().RODZINA_BACKUP_DIR, file));
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
