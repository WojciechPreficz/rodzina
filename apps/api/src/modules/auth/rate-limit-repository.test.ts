// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createDatabase } from '../../db/client.js';
import { loadConfig } from '../../config.js';
import { authRateLimits } from '../../db/schema.js';
import { createAuthRateLimitRepository } from './rate-limit-repository.js';
import { createLoginRateLimitKey, LOGIN_RATE_LIMIT, LOGIN_RATE_WINDOW_MS } from './rate-limit-service.js';

let directory: string;
let database: ReturnType<typeof createDatabase>;
beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'rodzina-limit-repository-'));
  database = createDatabase(loadConfig({ RODZINA_DATABASE_PATH: path.join(directory, 'limits.db') }));
  migrate(database.db, { migrationsFolder: './apps/api/drizzle' });
});
afterEach(() => {
  database.sqlite.close();
  rmSync(directory, { recursive: true, force: true });
});

it('separates scopes and structured identities even if they contain delimiters', () => {
  const keys = [
    createLoginRateLimitKey('password', 'ip', 'family', 'user'),
    createLoginRateLimitKey('child', 'ip', 'family', 'user'),
    createLoginRateLimitKey('child', 'ip', 'family:user'),
    createLoginRateLimitKey('child', 'ip:family', 'user'),
    createLoginRateLimitKey('child', 'ip', 'other-family', 'user'),
    createLoginRateLimitKey('child', 'ip', 'family', 'other-user'),
  ];
  expect(new Set(keys).size).toBe(keys.length);
});

it('deletes expired counters including the boundary and preserves active counters', () => {
  const repository = createAuthRateLimitRepository(database);
  const now = Date.now();
  database.db
    .insert(authRateLimits)
    .values([
      { scopeKey: 'expired', count: 10, expiresAt: now - 1 },
      { scopeKey: 'boundary', count: 10, expiresAt: now },
      { scopeKey: 'active', count: 10, expiresAt: now + 1 },
    ])
    .run();
  expect(repository.deleteExpired(now)).toBe(2);
  expect(repository.deleteExpired(now)).toBe(0);
  expect(database.db.select().from(authRateLimits).all()).toEqual([
    { scopeKey: 'active', count: 10, expiresAt: now + 1 },
  ]);
});

it('serializes simultaneous writers in independent workers without lost increments', async () => {
  const gate = new SharedArrayBuffer(4);
  const workers = Array.from(
    { length: 4 },
    () =>
      new Worker(
        `
    require('tsx/cjs');
    const { parentPort, workerData } = require('node:worker_threads');
    const { createDatabase } = require(workerData.client);
    const { loadConfig } = require(workerData.config);
    const { createAuthRateLimitRepository } = require(workerData.repository);
    const database = createDatabase(loadConfig({ RODZINA_DATABASE_PATH: workerData.filename }));
    const repository = createAuthRateLimitRepository(database);
    parentPort.postMessage('ready');
    Atomics.wait(new Int32Array(workerData.gate), 0, 0);
    let accepted = 0;
    for (let i = 0; i < 10; i++) {
      if (repository.consume('shared', workerData.now, workerData.limit, workerData.windowMs)) accepted++;
    }
    database.sqlite.close();
    parentPort.postMessage(accepted);
  `,
        {
          eval: true,
          workerData: {
            client: path.resolve('apps/api/src/db/client.ts'),
            config: path.resolve('apps/api/src/config.ts'),
            repository: path.resolve('apps/api/src/modules/auth/rate-limit-repository.ts'),
            filename: path.join(directory, 'limits.db'),
            gate,
            now: Date.now(),
            limit: LOGIN_RATE_LIMIT,
            windowMs: LOGIN_RATE_WINDOW_MS,
          },
        },
      ),
  );
  const ready: Promise<void>[] = [];
  const results: Promise<number>[] = [];
  for (const worker of workers) {
    ready.push(
      new Promise((resolve, reject) => {
        worker.once('message', () => resolve());
        worker.once('error', reject);
      }),
    );
    results.push(
      new Promise((resolve, reject) => {
        worker.on('message', (value) => {
          if (typeof value === 'number') resolve(value);
        });
        worker.once('error', reject);
        worker.once('exit', (code) => {
          if (code !== 0) reject(new Error(`Worker exited with ${code}`));
        });
      }),
    );
  }
  // Observe result rejections even if a worker fails before all workers become ready.
  const completed = Promise.all(results);
  void completed.catch(() => {});
  try {
    await Promise.all(ready);
    Atomics.store(new Int32Array(gate), 0, 1);
    Atomics.notify(new Int32Array(gate), 0);
    expect((await completed).reduce((sum, count) => sum + count, 0)).toBe(10);
    expect(database.db.select().from(authRateLimits).get()?.count).toBe(10);
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
}, 20000);
