import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { unzipSync } from 'fflate';

export const origin = 'https://rodzina.preficze.pl';
export const managed = ['server.cjs', 'package.json', 'dist', 'public', 'drizzle'];

export function validateConfig(env) {
  if (env.GITHUB_REF !== 'refs/heads/main') throw new Error('Deploy requires refs/heads/main.');
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')) throw new Error('Missing commit SHA.');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(env.DEPLOY_HOST ?? '')) throw new Error('Invalid DEPLOY_HOST.');
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/.test(env.DEPLOY_USER ?? '')) throw new Error('Invalid DEPLOY_USER.');
  const port = env.DEPLOY_PORT || '22';
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid DEPLOY_PORT.');
  for (const name of ['DEPLOY_PATH', 'DEPLOY_NODE', 'DEPLOY_ENV_FILE']) {
    const value = env[name] ?? '';
    if (
      !/^\/[a-zA-Z0-9_./-]+$/.test(value) ||
      path.posix.normalize(value) !== value ||
      value === '/' ||
      value.endsWith('/')
    )
      throw new Error(`Invalid absolute path: ${name}.`);
  }
  if (!env.DEPLOY_NODE.includes('/nodevenv/') || !env.DEPLOY_NODE.endsWith('/bin/node'))
    throw new Error('DEPLOY_NODE must point to nodevenv bin/node.');
  if (!env.DEPLOY_SSH_KEY?.trim() || !env.DEPLOY_KNOWN_HOSTS?.trim()) throw new Error('Missing SSH secrets.');
  return {
    root: env.DEPLOY_PATH,
    node: env.DEPLOY_NODE,
    envFile: env.DEPLOY_ENV_FILE,
    host: env.DEPLOY_HOST,
    user: env.DEPLOY_USER,
    port,
    sha: env.GITHUB_SHA,
  };
}

export function validateArchive(bytes) {
  const entries = unzipSync(bytes);
  const names = Object.keys(entries).filter((name) => !name.endsWith('/'));
  for (const name of Object.keys(entries)) {
    const parts = name.replace(/\/$/, '').split('/');
    if (
      name.includes('\\') ||
      name.startsWith('/') ||
      parts.some((part) => !part || part === '.' || part === '..') ||
      !managed.includes(parts[0]) ||
      parts.some((part) => part.startsWith('.') || /\.(?:db|sqlite|apk|jks|pem|key)(?:[.-]|$)/i.test(part)) ||
      (parts.length === 1 && !name.endsWith('/') && !['server.cjs', 'package.json'].includes(name))
    )
      throw new Error(`Unexpected release entry: ${name}`);
  }
  for (const required of [
    'server.cjs',
    'package.json',
    'dist/server.js',
    'dist/jobs/backup-db.js',
    'public/index.html',
    'drizzle/meta/_journal.json',
  ])
    if (!names.includes(required)) throw new Error(`Missing release entry: ${required}`);
  if (JSON.parse(Buffer.from(entries['package.json']).toString()).name !== 'rodzina-release')
    throw new Error('Wrong release application.');
  return createHash('sha256').update(bytes).digest('hex');
}

// Do not forward SSH/npm diagnostics: a remote command may include private configuration.
export async function run(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.once('error', () => reject(new Error(`Cannot start ${command}.`)));
    child.once('exit', (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(
            new Error(
              `${command} failed (exit ${code}, stage ${output.match(/DEPLOY_STAGE=([a-z-]+)/g)?.at(-1) ?? 'connection/command'}).`,
            ),
          ),
    );
  });
}

async function get(url, fetcher) {
  return fetcher(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000) });
}

export async function androidState(fetcher = fetch) {
  const response = await get(`${origin}/downloads/android/latest.json`, fetcher);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Cannot read Android metadata.');
  const data = await response.json();
  const url = new URL(data.apkUrl);
  if (
    url.origin !== origin ||
    !/^\/downloads\/android\/[a-zA-Z0-9._-]+\.apk$/.test(url.pathname) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    !Number.isSafeInteger(data.versionCode) ||
    data.versionCode < 1 ||
    typeof data.versionName !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(data.sha256 ?? '')
  )
    throw new Error('Invalid Android metadata.');
  const apk = await get(url.href, fetcher);
  if (!apk.ok || !apk.body) throw new Error('Cannot read published APK.');
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of apk.body) {
    size += chunk.length;
    if (size > 200 * 1024 * 1024) throw new Error('Published APK too large.');
    hash.update(chunk);
  }
  if (hash.digest('hex') !== data.sha256.toLowerCase()) throw new Error('Published APK checksum mismatch.');
  return JSON.stringify(data);
}

export async function checkSite(before, { fetcher = fetch, pause = delay, attempts = 6 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await get(`${origin}/api/health`, fetcher);
      const health = await response.json();
      if (!response.ok || health.ok !== true || health.dbOk !== true) throw new Error('Invalid health.');
      const page = await get(`${origin}/`, fetcher);
      if (!page.ok || !(await page.text()).includes('<div id="root"></div>')) throw new Error('Invalid page.');
      if ((await get(`${origin}/api/auth/me`, fetcher)).status !== 401) throw new Error('Invalid authentication.');
      if ((await androidState(fetcher)) !== before) throw new Error('Android publication changed.');
      return;
    } catch {
      if (attempt + 1 === attempts) throw new Error('Post-restart HTTP checks failed; recover using docs/DEPLOY.md.');
      await pause(5000);
    }
  }
}

export async function deploy({
  env = process.env,
  execute = run,
  fetcher = fetch,
  pause = delay,
  repository = fileURLToPath(new URL('../', import.meta.url)),
} = {}) {
  let phase = 'configuration';
  let directory;
  let remote;
  let transaction;
  let digest;
  const report = async (status) => {
    if (env.GITHUB_STEP_SUMMARY)
      await appendFile(
        env.GITHUB_STEP_SUMMARY,
        `\nDeploy: ${status}; stage: ${phase}\n\nCommit: \`${env.GITHUB_SHA}\`\n\nZIP SHA-256: \`${digest ?? 'not calculated'}\`\n`,
      );
  };
  try {
    const config = validateConfig(env);
    phase = 'checked archive';
    const archive = await readFile(path.join(repository, 'release.zip'));
    digest = validateArchive(archive);
    if ((await execute('git', ['rev-parse', 'HEAD'])) !== config.sha)
      throw new Error('Checkout SHA differs from requested commit.');
    phase = 'Android baseline';
    const before = await androidState(fetcher);
    directory = await mkdtemp(path.join(tmpdir(), 'rodzina-ssh-'));
    await chmod(directory, 0o700);
    const key = path.join(directory, 'identity');
    const hosts = path.join(directory, 'known_hosts');
    await writeFile(key, `${env.DEPLOY_SSH_KEY.trim()}\n`, { mode: 0o600 });
    await writeFile(hosts, `${env.DEPLOY_KNOWN_HOSTS.trim()}\n`, { mode: 0o600 });
    // Direct arguments avoid platform-specific shell quoting of local paths.
    const options = [
      '-F',
      'none',
      '-i',
      key,
      '-o',
      `UserKnownHostsFile=${hosts}`,
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=15',
      '-o',
      'ServerAliveInterval=15',
      '-o',
      'ServerAliveCountMax=3',
    ];
    const target = `${config.user}@${config.host}`;
    const source = await readFile(new URL('./deploy-remote.mjs', import.meta.url), 'utf8');
    remote = (action, extra = {}) =>
      execute(
        'ssh',
        [
          ...options,
          '-p',
          config.port,
          target,
          `${config.node} --input-type=module - ${action} ${Buffer.from(JSON.stringify({ ...config, digest, ...extra })).toString('base64url')}`,
        ],
        source,
      );
    phase = 'remote preflight';
    transaction = JSON.parse(await remote('prepare'));
    if (!/^\/[-a-zA-Z0-9_./]+$/.test(transaction.stage) || !/^[a-f0-9-]{36}$/.test(transaction.id))
      throw new Error('Invalid staging response.');
    phase = 'transfer';
    // Transfer the exact bytes that were validated, even if release.zip changes locally.
    const frozen = path.join(directory, 'release.zip');
    await writeFile(frozen, archive);
    await execute('scp', [...options, '-P', config.port, frozen, `${target}:${transaction.stage}/release.zip`]);
    phase = 'checksum / staging / dependencies / backup / promotion / restart';
    await remote('apply', transaction);
    phase = 'HTTP verification';
    await checkSite(before, { fetcher, pause });
    phase = 'completed';
    await report('success');
    console.log(`Deploy completed: ${config.sha}, ZIP SHA-256 ${digest}`);
  } catch (error) {
    await report('failed');
    throw new Error(`Deploy failed at ${phase}: ${error.message}`);
  } finally {
    if (remote && transaction)
      await remote('cleanup', transaction).catch(() => console.error('Remote staging cleanup requires attention.'));
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  deploy().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
