import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../config.js';
import { createDatabase, type DatabaseConnection } from '../db/client.js';

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

export function runBackup(): void {
  const config = loadConfig();
  const database = createDatabase(config);
  try {
    const result = backupDatabase(database, config.RODZINA_BACKUP_DIR);
    console.log(JSON.stringify({ event: 'backup_finished', ...result }));
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
