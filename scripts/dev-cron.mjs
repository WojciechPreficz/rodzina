import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let stopping = false;
let child;
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    stopping = true;
    controller.abort();
    child?.kill();
  });
}

while (!stopping) {
  await new Promise((resolve, reject) => {
    child = spawn(
      process.execPath,
      ['--import', 'tsx', '--env-file=apps/api/.env', 'apps/api/src/jobs/send-reminders.ts'],
      {
        cwd: root,
        stdio: 'inherit',
      },
    );
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code && !stopping) console.error(`Job przypomnień zakończył się kodem ${code}.`);
      child = undefined;
      resolve();
    });
  });
  if (!stopping) await delay(60000, undefined, { signal: controller.signal }).catch(() => {});
}
