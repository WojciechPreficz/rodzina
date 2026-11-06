// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';

it('serves a public landing page with CSP and keeps missing assets out of the SPA fallback', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'rodzina-landing-'));
  mkdirSync(path.join(directory, 'strona'));
  writeFileSync(path.join(directory, 'index.html'), '<html>Application shell</html>');
  writeFileSync(path.join(directory, 'strona/index.html'), '<html>Family landing</html>');
  writeFileSync(path.join(directory, 'strona/config.js'), 'window.APP_BASE_URL = window.location.origin;');
  const config = loadConfig({ NODE_ENV: 'production', RODZINA_DATABASE_PATH: ':memory:', RODZINA_WEB_DIR: directory });
  const database = createDatabase(config);
  migrate(database.db, { migrationsFolder: './apps/api/drizzle' });
  const app = await buildApp(config, database);
  try {
    const redirect = await app.inject({ url: '/strona?source=test' });
    expect(redirect.statusCode).toBe(302);
    expect(redirect.headers.location).toBe('/strona/?source=test');
    for (const url of ['/strona/', '/strona/index.html']) {
      const response = await app.inject({ url });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('Family landing');
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.headers['content-security-policy']).toContain("script-src 'self'");
    }
    const script = await app.inject({ url: '/strona/config.js' });
    expect(script.statusCode).toBe(200);
    expect(script.headers['content-type']).toContain('javascript');
    for (const url of ['/strona/missing.js', '/%73trona/missing.css']) {
      const response = await app.inject({ url });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('NOT_FOUND');
    }
    expect((await app.inject({ url: '/login' })).body).toContain('Application shell');
    expect((await app.inject({ url: '/api/auth/me' })).statusCode).toBe(401);
  } finally {
    await app.close();
    database.sqlite.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
