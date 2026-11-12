import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getTableName, lt, lte } from 'drizzle-orm';
import { loadConfig } from '../config.js';
import { createDatabase, type DatabaseConnection } from '../db/client.js';
import { OPERATION_RETENTION_MS } from '../db/operation-retention.js';
import {
  eventImportOperations,
  invitationEmailVerifications,
  invitations,
  passwordResets,
  sessions,
  shoppingOperations,
  taskOperations,
} from '../db/schema.js';
import { createAuthRateLimitService } from '../modules/auth/rate-limit-service.js';

export function deleteExpiredSessions(database: DatabaseConnection, nowMs: number): number {
  return database.db.delete(sessions).where(lte(sessions.expiresAt, nowMs)).run().changes;
}

function deleteExpiredRecords(database: DatabaseConnection, nowMs: number): void {
  const cutoff = nowMs - OPERATION_RETENTION_MS;
  const deletions = [
    [passwordResets, lte(passwordResets.expiresAt, nowMs)],
    [invitationEmailVerifications, lte(invitationEmailVerifications.expiresAt, nowMs)],
    [invitations, lte(invitations.expiresAt, nowMs)],
    [eventImportOperations, lt(eventImportOperations.createdAt, cutoff)],
    [shoppingOperations, lt(shoppingOperations.createdAt, cutoff)],
    [taskOperations, lt(taskOperations.createdAt, cutoff)],
  ] as const;
  for (const [table, condition] of deletions) {
    const name = getTableName(table);
    try {
      const removed = database.db.delete(table).where(condition).run().changes;
      console.log(JSON.stringify({ event: 'expired_records_deleted', table: name, removed }));
    } catch {
      console.error(JSON.stringify({ event: 'expired_records_cleanup_failed', table: name }));
    }
  }
}

export function backupDatabase(database: DatabaseConnection, directory: string, now = Date.now()) {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const destination = path.resolve(directory, `rodzina-${date}.db`);
  const temporary = path.resolve(directory, `.rodzina-${randomUUID()}.tmp`);
  mkdirSync(directory, { recursive: true });
  try {
    // Publish only a completed snapshot; a failed rerun keeps the previous daily copy.
    database.sqlite.prepare('VACUUM INTO ?').run(temporary);
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }

  const copies = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^rodzina-\d{4}-\d{2}-\d{2}\.db$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const name of copies.slice(14)) rmSync(path.resolve(directory, name));
  return { file: destination, removed: Math.max(0, copies.length - 14) };
}

export function runBackup(config = loadConfig()): void {
  const database = createDatabase(config);
  try {
    const result = backupDatabase(database, config.RODZINA_BACKUP_DIR);
    console.log(JSON.stringify({ event: 'backup_finished', ...result }));
    const now = Date.now();
    try {
      const removed = deleteExpiredSessions(database, now);
      console.log(JSON.stringify({ event: 'expired_sessions_deleted', removed }));
    } catch {
      console.error(
        JSON.stringify({ event: 'session_cleanup_failed', reason: 'Nie udało się usunąć wygasłych sesji.' }),
      );
    }
    try {
      const removed = createAuthRateLimitService(database).deleteExpired(now);
      console.log(JSON.stringify({ event: 'expired_auth_rate_limits_deleted', removed }));
    } catch {
      console.error(
        JSON.stringify({
          event: 'auth_rate_limit_cleanup_failed',
          reason: 'Nie udało się usunąć wygasłych limitów logowania.',
        }),
      );
    }
    deleteExpiredRecords(database, now);
  } finally {
    database.sqlite.close();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    runBackup();
  } catch {
    console.error(
      JSON.stringify({ event: 'backup_failed', reason: 'Sprawdź konfigurację i dostęp do bazy i katalogu kopii.' }),
    );
    process.exitCode = 1;
  }
}
