import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../db/client.js';
import { loadConfig } from '../config.js';

describe('heartbeat job storage', () => {
  let sqlite: ReturnType<typeof createDatabase>['sqlite'] | undefined;

  afterEach(() => sqlite?.close());

  it('can record a job run in SQLite', () => {
    const database = createDatabase(loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:' }));
    sqlite = database.sqlite;
    sqlite.exec('CREATE TABLE job_runs (id TEXT PRIMARY KEY NOT NULL, job TEXT NOT NULL, ran_at INTEGER NOT NULL)');
    sqlite.prepare('INSERT INTO job_runs (id, job, ran_at) VALUES (?, ?, ?)').run('test-run', 'heartbeat', 123);

    expect(sqlite.prepare('SELECT job, ran_at FROM job_runs').get()).toEqual({
      job: 'heartbeat',
      ran_at: 123,
    });
  });
});
