import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { loadConfig } from '../../apps/api/src/config.js';
import { createDatabase } from '../../apps/api/src/db/client.js';
import { buildApp } from '../../apps/api/src/app.js';

// Isolated inbox through IPC only; the production server never exposes test messages.
const config = loadConfig({
  NODE_ENV: 'production',
  RODZINA_DATABASE_PATH: ':memory:',
  RODZINA_ALLOW_REGISTRATION: 'true',
  RODZINA_WEB_DIR: path.resolve('apps/web/dist'),
  RODZINA_PUBLIC_URL: 'https://rodzina.example.com',
  RODZINA_PASSWORD_RESET_EMAIL_ENABLED: 'true',
  RODZINA_SMTP_HOST: 'unused.example.com',
  RODZINA_SMTP_USER: 'test',
  RODZINA_SMTP_PASSWORD: 'test-only',
  RODZINA_MAIL_FROM: 'sender@example.com',
});
const database = createDatabase(config);
migrate(database.db, { migrationsFolder: './apps/api/drizzle' });
const app = await buildApp(config, database, async (_config, mail) => {
  process.send?.({ type: 'mail', mail });
});
await app.listen({ host: '127.0.0.1', port: 0 });
process.send?.({ type: 'ready', url: `http://127.0.0.1:${(app.server.address() as { port: number }).port}` });
process.once('disconnect', () => {
  void app.close().finally(() => {
    database.sqlite.close();
    process.exit(0);
  });
});
