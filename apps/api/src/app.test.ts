import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';

describe('GET /api/health', () => {
  let sqlite: ReturnType<typeof createDatabase>['sqlite'] | undefined;

  afterEach(() => sqlite?.close());

  it('reports a healthy SQLite database', async () => {
    const config = loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' });
    const database = createDatabase(config);
    sqlite = database.sqlite;
    const app = await buildApp(config, database);

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, dbOk: true });
    expect(response.json().version).toEqual(expect.any(String));
    await app.close();
  });
});
