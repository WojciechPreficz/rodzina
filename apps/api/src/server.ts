import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { createDatabase } from './db/client.js';

const config = loadConfig();
const database = createDatabase(config);
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');

migrate(database.db, { migrationsFolder });

const app = await buildApp(config, database);
try {
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  database.sqlite.close();
  process.exitCode = 1;
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    database.sqlite.close();
  });
}
