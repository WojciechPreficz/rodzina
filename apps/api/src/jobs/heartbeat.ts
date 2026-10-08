import { loadConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { pathToFileURL } from 'node:url';

export function runHeartbeat(): void {
  const config = loadConfig();
  const database = createDatabase(config);

  try {
    database.sqlite
      .prepare('INSERT INTO job_runs (id, job, ran_at) VALUES (?, ?, ?)')
      .run(crypto.randomUUID(), 'heartbeat', Date.now());
    console.log('Heartbeat zapisany.');
  } finally {
    database.sqlite.close();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runHeartbeat();
}
