import { spawn } from 'node:child_process';
import webPush from 'web-push';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
  if (Object.keys(entries).some((name) => /^dist\/jobs\/heartbeat\./.test(name))) {
    fail('paczka nadal zawiera usunięty job heartbeat.');
  }
  for (const [name, contents] of Object.entries(entries)) {
    const destination = path.resolve(temporaryDirectory, name);
    if (!destination.startsWith(`${temporaryDirectory}${path.sep}`)) fail('Nieprawidłowa ścieżka w ZIP.');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }

  const port = 3000 + Math.floor(Math.random() * 10000);
  const envFile = path.join(temporaryDirectory, 'smoke.env');
  const vapid = webPush.generateVAPIDKeys();
  await writeFile(
    envFile,
    [
      'NODE_ENV=production',
      `PORT=${port}`,
      `RODZINA_DATABASE_PATH=${path.join(temporaryDirectory, 'smoke.db')}`,
      `RODZINA_BACKUP_DIR=${path.join(temporaryDirectory, 'backups')}`,
      `RODZINA_WEB_DIR=${path.join(temporaryDirectory, 'public')}`,
      'RODZINA_PUBLIC_URL=http://localhost',
      'RODZINA_ANDROID_DOWNLOAD_DIR=',
      'RODZINA_ALLOW_REGISTRATION=false',
      `RODZINA_VAPID_PUBLIC_KEY=${vapid.publicKey}`,
      `RODZINA_VAPID_PRIVATE_KEY=${vapid.privateKey}`,
      'RODZINA_VAPID_SUBJECT=mailto:smoke@example.com',
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
  const noRelease = await fetch(`http://127.0.0.1:${port}/downloads/android/latest.json`);
  if (
    noRelease.status !== 404 ||
    noRelease.headers.get('cache-control') !== 'no-store' ||
    !noRelease.headers.get('content-type')?.includes('application/json')
  )
    fail('brak APK nie jest jawnym 404 JSON bez cache.');
  const absentApk = await fetch(`http://127.0.0.1:${port}/downloads/android/rodzina-1-1.0.0.apk`);
  if (absentApk.status !== 404) fail('brak APK zwraca SPA zamiast 404.');
  if (
    !pageResponse.headers.get('content-security-policy')?.includes("object-src 'none'") ||
    pageResponse.headers.get('x-content-type-options') !== 'nosniff'
  )
    fail('brak nagłówków ochrony strony.');
  if (protectedResponse.status !== 401) fail('auth/me nie wymaga sesji.');
  const appLinks = await fetch(`http://127.0.0.1:${port}/.well-known/assetlinks.json`);
  if (
    !appLinks.ok ||
    !appLinks.headers.get('content-type')?.includes('application/json') ||
    !Array.isArray(await appLinks.json())
  ) {
    fail('assetlinks.json nie jest publicznym dokumentem JSON.');
  }

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

  await run(process.execPath, ['--env-file', envFile, 'dist/jobs/send-reminders.js', '--now=2026-10-16T10:00:00Z'], {
    cwd: temporaryDirectory,
  });
  const { default: Database } = await import('better-sqlite3');
  await run(process.execPath, ['--env-file', envFile, 'dist/jobs/backup-db.js'], { cwd: temporaryDirectory });
  const copies = await readdir(path.join(temporaryDirectory, 'backups'));
  if (copies.length !== 1 || !/^rodzina-\d{4}-\d{2}-\d{2}\.db$/.test(copies[0])) {
    fail('job nie utworzył dziennej kopii bazy.');
  }
  const sqlite = new Database(path.join(temporaryDirectory, 'backups', copies[0]), { readonly: true });
  try {
    if (sqlite.pragma('integrity_check', { simple: true }) !== 'ok') fail('kopia bazy jest uszkodzona.');
    sqlite.prepare('SELECT id FROM reminders LIMIT 1').all();
    sqlite.prepare('SELECT id FROM push_subscriptions LIMIT 1').all();
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
