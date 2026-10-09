import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseFile = path.join(root, 'release.zip');
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'rodzina-smoke-'));
let server;

function fail(message) {
  throw new Error(`release:smoke: ${message}`);
}

async function waitForHealth(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return response;
    } catch {
      await delay(300);
    }
  }
  fail('API nie odpowiedziało w wyznaczonym czasie.');
}

async function run(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} zakończył się kodem ${code}`));
    });
  });
}

try {
  const archive = new Uint8Array(await readFile(releaseFile));
  const entries = unzipSync(archive);
  for (const [name, contents] of Object.entries(entries)) {
    const destination = path.resolve(temporaryDirectory, name);
    if (!destination.startsWith(`${temporaryDirectory}${path.sep}`)) fail('Nieprawidłowa ścieżka w ZIP.');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }

  const port = 3000 + Math.floor(Math.random() * 10000);
  const envFile = path.join(temporaryDirectory, 'smoke.env');
  await writeFile(
    envFile,
    [
      'NODE_ENV=production',
      `PORT=${port}`,
      `RODZINA_DATABASE_PATH=${path.join(temporaryDirectory, 'smoke.db')}`,
      `RODZINA_WEB_DIR=${path.join(temporaryDirectory, 'public')}`,
      'RODZINA_PUBLIC_URL=http://localhost',
      'RODZINA_ALLOW_REGISTRATION=false',
      '',
    ].join('\n'),
  );

  if (!process.env.npm_execpath) fail('nie można ustalić ścieżki do npm CLI.');
  await run(process.execPath, [process.env.npm_execpath, 'install', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: temporaryDirectory,
  });
  server = spawn(process.execPath, ['server.cjs'], {
    cwd: temporaryDirectory,
    env: { ...process.env, RODZINA_ENV_FILE: envFile },
    stdio: 'inherit',
  });

  const healthResponse = await waitForHealth(port);
  const health = await healthResponse.json();
  if (health.ok !== true || health.dbOk !== true) fail('health check nie potwierdził sprawnej bazy.');

  const pageResponse = await fetch(`http://127.0.0.1:${port}/`);
  const page = await pageResponse.text();
  if (!pageResponse.ok || !page.includes('<div id="root"></div>')) {
    fail('serwer nie dostarczył index.html.');
  }

  for (const route of ['/zaproszenie/smoke-token', '/reset-hasla/smoke-token', '/login-child']) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`);
    if (!response.ok || !(await response.text()).includes('<div id="root"></div>')) {
      fail(`serwer nie dostarczył SPA dla ${route}.`);
    }
  }
  const protectedResponse = await fetch(`http://127.0.0.1:${port}/api/auth/me`);
  if (protectedResponse.status !== 401) fail('auth/me nie wymaga sesji.');

  const manifestResponse = await fetch(`http://127.0.0.1:${port}/manifest.webmanifest`);
  const manifest = await manifestResponse.json();
  if (
    !manifestResponse.ok ||
    manifest.name !== 'Rodzina' ||
    manifest.lang !== 'pl' ||
    manifest.display !== 'standalone' ||
    manifest.icons?.length !== 3
  ) {
    fail('manifest PWA nie zawiera wymaganych metadanych i ikon.');
  }
  const serviceWorkerResponse = await fetch(`http://127.0.0.1:${port}/sw.js`);
  if (!serviceWorkerResponse.ok || !(await serviceWorkerResponse.text()).length) {
    fail('serwer nie dostarczył service workera.');
  }

  await run(process.execPath, ['--env-file', envFile, 'dist/jobs/heartbeat.js'], { cwd: temporaryDirectory });
  const { default: Database } = await import('better-sqlite3');
  const sqlite = new Database(path.join(temporaryDirectory, 'smoke.db'));
  try {
    const runRow = sqlite.prepare('SELECT job FROM job_runs ORDER BY ran_at DESC LIMIT 1').get();
    if (runRow?.job !== 'heartbeat') fail('heartbeat nie zapisał wpisu do job_runs.');
  } finally {
    sqlite.close();
  }

  console.log('release:smoke zakończony pomyślnie.');
} finally {
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
}
