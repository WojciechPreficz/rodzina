import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';

export async function createTestApp(overrides?: Record<string, string>) {
  const config = loadConfig({
    NODE_ENV: 'test',
    RODZINA_DATABASE_PATH: ':memory:',
    RODZINA_PUBLIC_URL: 'http://localhost:3000',
    RODZINA_ALLOW_REGISTRATION: 'true',
    ...overrides,
  });
  const database = createDatabase(config);
  migrate(database.db, { migrationsFolder: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle') });
  const app = await buildApp(config, database);
  return { app, database, config };
}

export function trustedMutationHeaders(host = 'localhost:3000') {
  return { host, origin: `http://${host}` };
}
