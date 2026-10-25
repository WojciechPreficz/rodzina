import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { loadConfig } from '../config.js';
import { createDatabase } from '../db/client.js';

export function runMigrations(config = loadConfig()): void {
  const database = createDatabase(config);
  try {
    const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
    migrate(database.db, { migrationsFolder });
    console.log(JSON.stringify({ event: 'migrations_finished' }));
  } finally {
    database.sqlite.close();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    runMigrations();
  } catch (error) {
    console.error(JSON.stringify({ event: 'migrations_failed', reason: 'Nie udało się wykonać migracji bazy.' }));
    console.error(error);
    process.exitCode = 1;
  }
}
