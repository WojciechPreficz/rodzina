import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { prepareDependencies } from './deploy-remote.mjs';
import { validateArchive } from './deploy.mjs';

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
  validateArchive(archive);
  const entries = unzipSync(archive);
  if (Object.keys(entries).some((name) => /^dist\/jobs\/(?:heartbeat|send-reminders)\./.test(name))) {
    fail('paczka nadal zawiera usunięty job heartbeat lub send-reminders.');
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
      '',
    ].join('\n'),
  );

  if (!process.env.npm_execpath) fail('nie można ustalić ścieżki do npm CLI.');
  const config = { npm: process.env.npm_execpath, runtimeNode: process.execPath };
  const execute = (tool, args, cwd, env = process.env) => run(tool, args, { cwd, env });
  await prepareDependencies(config, temporaryDirectory, execute);
  // Repeat in an empty directory and compare actual installed versions on this platform.
  const second = await mkdtemp(path.join(tmpdir(), 'rodzina-smoke-repeat-'));
  try {
    for (const name of ['package.json', 'package-lock.json'])
      await cp(path.join(temporaryDirectory, name), path.join(second, name));
    await prepareDependencies(config, second, execute);
    const lock = JSON.parse(await readFile(path.join(second, 'package-lock.json'), 'utf8'));
    const snapshot = async (directory) => {
      const versions = {};
      for (const [name, node] of Object.entries(lock.packages)) {
        if (!name) continue;
        try {
          const installed = JSON.parse(await readFile(path.join(directory, name, 'package.json'), 'utf8'));
          if (installed.version !== node.version) fail(`wersja ${name} różni się od lockfile.`);
          versions[name] = installed.version;
        } catch (error) {
          if (error.code !== 'ENOENT' || !node.optional) throw error;
        }
      }
      return JSON.stringify(versions);
    };
    if ((await snapshot(temporaryDirectory)) !== (await snapshot(second))) fail('instalacje mają różne wersje.');
    if (
      (await readFile(path.join(second, 'package-lock.json'), 'utf8')) !==
      Buffer.from(entries['package-lock.json']).toString()
    )
      fail('instalacja zmieniła lockfile.');
  } finally {
    await rm(second, { recursive: true, force: true });
  }
  // A production process must refuse an unmigrated database with an actionable error.
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.cjs'], {
      cwd: temporaryDirectory,
      env: { ...process.env, RODZINA_ENV_FILE: envFile, NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20000,
    });
    let output = '';
    child.stdout.on('data', (data) => (output += data));
    child.stderr.on('data', (data) => (output += data));
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 1 && output.includes('Baza wymaga migracji') && output.includes('dist/jobs/migrate-db.js'))
        resolve();
      else reject(new Error('Produkcja nie odrzuciła bazy bez migracji z czytelnym błędem.'));
    });
  });
  // The runtime job must work from the release, with production dependencies only, and be repeatable.
  for (let attempt = 0; attempt < 2; attempt++) {
    await run(process.execPath, ['--env-file', envFile, 'dist/jobs/migrate-db.js'], { cwd: temporaryDirectory });
  }
  const releasePackage = JSON.parse(await readFile(path.join(temporaryDirectory, 'package.json'), 'utf8'));
  const serverEnv = { ...process.env, RODZINA_ENV_FILE: envFile };
  delete serverEnv.npm_package_version;
  server = spawn(process.execPath, ['server.cjs'], {
    cwd: temporaryDirectory,
    env: serverEnv,
    stdio: 'inherit',
  });

  const healthResponse = await waitForHealth(port);
  const health = await healthResponse.json();
  if (health.ok !== true || health.dbOk !== true) fail('health check nie potwierdził sprawnej bazy.');
  if (typeof health.version !== 'string' || !health.version || health.version !== releasePackage.version) {
    fail('wersja health check nie odpowiada wersji package.json w paczce release.');
  }

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
  if (manifestResponse.status !== 410 || /rel=["']manifest["']/.test(page))
    fail('strona nadal udostępnia manifest PWA.');
  if (Object.keys(entries).some((name) => name === 'public/manifest.webmanifest' || /^public\/workbox-/.test(name)))
    fail('paczka nadal zawiera zasoby PWA.');
  const serviceWorkerResponse = await fetch(`http://127.0.0.1:${port}/sw.js`);
  const retirement = await serviceWorkerResponse.text();
  if (
    !serviceWorkerResponse.ok ||
    serviceWorkerResponse.headers.get('cache-control') !== 'no-store' ||
    !retirement.includes('self.registration.unregister()') ||
    retirement.includes('showNotification')
  ) {
    fail('serwer nie dostarczył skryptu wycofującego stare PWA bez cache.');
  }

  await run(process.execPath, ['--env-file', envFile, 'dist/jobs/backup-db.js'], { cwd: temporaryDirectory });
  const copies = await readdir(path.join(temporaryDirectory, 'backups'));
  if (copies.length !== 1 || !/^rodzina-\d{4}-\d{2}-\d{2}\.db$/.test(copies[0])) {
    fail('job nie utworzył dziennej kopii bazy.');
  }
  // A child releases the native DLL before temporary files are removed on Windows.
  await run(
    process.execPath,
    [
      '--input-type=commonjs',
      '-e',
      `
    const Database = require('better-sqlite3');
    const sqlite = new Database(process.argv[1], { readonly: true });
    try {
      if (sqlite.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Corrupt backup.');
      sqlite.prepare('SELECT id FROM reminders LIMIT 1').all();
      sqlite.prepare('SELECT scope_key, count, expires_at FROM auth_rate_limits LIMIT 1').all();
      if (sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'push_subscriptions'").get())
        throw new Error('Backup still contains Web Push subscriptions.');
    } finally { sqlite.close(); }
  `,
      path.join(temporaryDirectory, 'backups', copies[0]),
    ],
    { cwd: temporaryDirectory },
  );

  console.log('release:smoke zakończony pomyślnie.');
} finally {
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
}
