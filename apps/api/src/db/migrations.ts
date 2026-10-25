import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { DatabaseConnection } from './client.js';

export function assertMigrationsApplied(database: DatabaseConnection, migrationsFolder: string): void {
  const migrations = readMigrationFiles({ migrationsFolder });
  const hasJournal = database.sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  const applied = new Set(
    hasJournal
      ? (database.sqlite.prepare('SELECT created_at FROM __drizzle_migrations').all() as { created_at: number }[]).map(
          (row) => Number(row.created_at),
        )
      : [],
  );
  const pending = migrations.filter((migration) => !applied.has(migration.folderMillis));
  if (pending.length > 0) {
    throw new Error(
      `Baza wymaga migracji (${pending.length}). Przed startem API uruchom dist/jobs/migrate-db.js z konfiguracją produkcyjną, po wykonaniu backupu.`,
    );
  }
}
