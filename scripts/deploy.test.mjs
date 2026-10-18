// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zipSync, unzipSync } from 'fflate';
import { androidState, checkSite, deploy, managed, validateArchive, validateConfig } from './deploy.mjs';
import { applyRelease, preflight } from './deploy-remote.mjs';

const sha = 'a'.repeat(40);
const env = {
  GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: sha,
  DEPLOY_HOST: 'hosting.example.com',
  DEPLOY_USER: 'owner',
  DEPLOY_PATH: '/home/owner/rodzina',
  DEPLOY_NODE: '/home/owner/nodevenv/rodzina/24/bin/node',
  DEPLOY_ENV_FILE: '/home/owner/rodzina-data/.env',
  DEPLOY_SSH_KEY: 'PRIVATE-TEST-KEY',
  DEPLOY_KNOWN_HOSTS: 'VERIFIED-TEST-HOST',
};
const releaseFiles = {
  'package.json': JSON.stringify({ name: 'rodzina-release' }),
  'server.cjs': 'new server',
  'dist/server.js': 'new API',
  'dist/jobs/backup-db.js': 'backup job',
  'public/index.html': '<div id="root"></div>',
  'public/assets/app.js': 'new UI',
  'drizzle/meta/_journal.json': '{}',
};
const archive = (files = releaseFiles) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, Buffer.from(value)])));
const directories = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function write(directory, name, contents) {
  await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
  await writeFile(path.join(directory, name), contents);
}
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'rodzina-deploy-test-'));
  directories.push(directory);
  const root = path.join(directory, 'app');
  const stage = path.join(directory, 'stage');
  for (const name of Object.keys(releaseFiles)) await write(root, name, `old ${name}`);
  const protectedFiles = [
    '.env',
    '.htaccess',
    'data/production.db',
    'data/production.db-wal',
    'data/production.db-shm',
    'backups/daily.db',
    'logs/cron.log',
    'downloads/android/latest.json',
    'downloads/android/old.apk',
    'cron.txt',
  ];
  for (const name of protectedFiles) await write(root, name, `keep ${name}`);
  await write(root, 'public/assets/old.js', 'old asset for existing browser tabs');
  await write(root, 'node_modules/old-package/index.js', 'old dependency');
  const bytes = archive();
  await write(stage, 'release.zip', bytes);
  const config = {
    root,
    modules: path.join(root, 'node_modules'),
    node: process.execPath,
    envFile: path.join(root, '.env'),
    sha,
    digest: validateArchive(bytes),
  };
  const transaction = { stage, id: randomUUID() };
  const events = [];
  const options = {
    mark: (event) => events.push(event),
    extract: async (destination) => {
      for (const [name, contents] of Object.entries(unzipSync(bytes))) await write(destination, name, contents);
    },
    dependencies: async (unpacked) => write(unpacked, 'node_modules/new-package/index.js', 'installed dependency'),
    backup: vi.fn(async () => {
      await write(root, 'backups/pre-deploy.db', 'database snapshot');
    }),
    execute: vi.fn(async (tool, args) => {
      expect(tool).toBe('tar');
      expect(args.slice(2)).toEqual(managed);
      await writeFile(args[1], 'previous application archive');
    }),
  };
  return { directory, root, stage, protectedFiles, config, transaction, options, events };
}
const http = async (url) => {
  const pathname = new URL(url).pathname;
  if (pathname === '/api/health') return Response.json({ ok: true, dbOk: true });
  if (pathname === '/') return new Response('<div id="root"></div>');
  if (pathname === '/api/auth/me') return new Response('', { status: 401 });
  return new Response('', { status: 404 });
};

describe('deploy configuration and archive', () => {
  it('requires main, immutable commit, safe host, port, nodevenv and absolute paths before SSH', () => {
    expect(validateConfig(env).port).toBe('22');
    for (const [key, value] of Object.entries({
      GITHUB_REF: 'refs/heads/dev',
      GITHUB_SHA: 'main',
      DEPLOY_HOST: '-oProxyCommand=bad',
      DEPLOY_USER: 'x\nHost *',
      DEPLOY_PORT: '65536',
      DEPLOY_PATH: '/',
      DEPLOY_NODE: '/usr/bin/node',
      DEPLOY_ENV_FILE: '/home/x/../.env',
    }))
      expect(() => validateConfig({ ...env, [key]: value })).toThrow();
    for (const value of ['relative', '/home/user/a b', '/home/user/./app', '/home/user/app/', '/home/user/$app'])
      expect(() => validateConfig({ ...env, DEPLOY_PATH: value })).toThrow();
  });
  it('rejects secrets, data, APK, extra roots, missing files and wrong applications', () => {
    expect(validateArchive(archive())).toMatch(/^[a-f0-9]{64}$/);
    for (const name of [
      '.env',
      'public/private.db-wal',
      'public/test.apk',
      'node_modules/test.js',
      'dist/../../outside',
      'public/.htaccess',
      'public/a\\evil',
    ])
      expect(() => validateArchive(archive({ ...releaseFiles, [name]: 'bad' }))).toThrow();
    expect(() => validateArchive(archive({ ...releaseFiles, 'package.json': '{"name":"other"}' }))).toThrow();
    const incomplete = { ...releaseFiles };
    delete incomplete['public/index.html'];
    expect(() => validateArchive(archive(incomplete))).toThrow();
  });
  it('workflow is manual only, rejects other branches before checkout and checks before deploy', async () => {
    const workflow = await readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
    expect(workflow).toMatch(/on:\s+workflow_dispatch:\s+permissions:/);
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('persist-credentials: false');
    expect(workflow).toContain('ref: ${{ github.sha }}');
    expect(workflow).toContain('group: rodzina-production');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow.indexOf('test "$DEPLOY_REF" = refs/heads/main')).toBeLessThan(workflow.indexOf('actions/checkout'));
    for (const check of [
      'npm ci',
      'npm run lint',
      'npm run format:check',
      'npm run typecheck',
      'npm test',
      'npm run build',
      'npm run test:e2e',
      'npm run release:smoke',
    ]) {
      expect(workflow.indexOf(`run: ${check}`)).toBeGreaterThan(-1);
      expect(workflow.indexOf(`run: ${check}`)).toBeLessThan(workflow.indexOf('run: node scripts/deploy.mjs'));
    }
  });
});

it.skipIf(Number(process.versions.node.split('.')[0]) !== 24)(
  'remote preflight rejects wrong application, environment, protected paths and missing tools before staging',
  async () => {
    const f = await fixture();
    const config = { ...f.config, node: path.join(f.directory, 'bin/node') };
    await write(f.directory, 'bin/node', 'node executable');
    await write(f.directory, 'bin/npm', 'npm CLI');
    const environment = {
      NODE_ENV: 'production',
      RODZINA_PUBLIC_URL: 'https://rodzina.preficze.pl',
      RODZINA_DATABASE_PATH: path.join(f.root, 'data/production.db'),
      RODZINA_BACKUP_DIR: path.join(f.root, 'backups'),
    };
    const execute = vi.fn(async () => {});
    await write(f.root, 'package.json', JSON.stringify({ name: 'other-app' }));
    await expect(preflight(config, { execute, environment })).rejects.toThrow('not the existing');
    await write(f.root, 'package.json', JSON.stringify({ name: 'rodzina-release' }));
    await preflight(config, { execute, environment });
    expect(execute).toHaveBeenCalledTimes(3);
    for (const changes of [
      { NODE_ENV: 'development' },
      { RODZINA_PUBLIC_URL: 'https://other.example.com' },
      { RODZINA_WEB_DIR: '../other/public' },
      { RODZINA_DATABASE_PATH: path.join(f.root, 'public/index.html') },
      { RODZINA_ANDROID_DOWNLOAD_DIR: path.join(f.root, 'downloads') },
    ])
      await expect(preflight(config, { execute, environment: { ...environment, ...changes } })).rejects.toThrow();
    await expect(
      preflight(config, {
        environment,
        execute: async () => {
          throw new Error('missing tool');
        },
      }),
    ).rejects.toThrow('missing tool');
    await write(f.root, 'dist/private.db', 'must not overwrite');
    await expect(preflight(config, { execute, environment })).rejects.toThrow('Protected data');
    expect(await readdir(f.directory)).not.toContain('.app-deploy-lock');
  },
);

describe('local directory with fake SSH transport', () => {
  it('transfers checked bytes, backs up before promotion, preserves private data and APK, restarts and checks HTTP', async () => {
    const f = await fixture();
    await write(f.directory, 'release.zip', archive());
    const execute = vi.fn(async (tool, args) => {
      if (tool === 'git') return sha;
      expect(args).toContain('StrictHostKeyChecking=yes');
      if (tool === 'scp') {
        await writeFile(path.join(f.stage, 'release.zip'), await readFile(args.at(-2)));
        return '';
      }
      const action = args.at(-1).split(' ').at(-2);
      if (action === 'prepare') return JSON.stringify({ stage: '/tmp/rodzina-stage', id: f.transaction.id });
      if (action === 'apply') await applyRelease(f.config, f.transaction, f.options);
      return '';
    });
    await deploy({ env, execute, repository: f.directory, fetcher: http });
    expect(await readFile(path.join(f.root, 'dist/server.js'), 'utf8')).toBe('new API');
    expect(await readFile(path.join(f.root, 'tmp/restart.txt'), 'utf8')).toBe('');
    for (const name of f.protectedFiles) expect(await readFile(path.join(f.root, name), 'utf8')).toBe(`keep ${name}`);
    expect(await readFile(path.join(f.root, 'public/assets/old.js'), 'utf8')).toContain('old asset');
    expect(f.events).toEqual([
      'checksum',
      'extraction',
      'dependencies',
      'backup',
      'previous-package',
      'promotion',
      'restart',
    ]);
    expect(await readdir(path.join(f.directory, 'app-deploy-history'))).toHaveLength(3);
    expect(execute.mock.calls.some(([tool]) => tool === 'scp')).toBe(true);
  });
  it.each(['checksum', 'extraction', 'dependencies', 'backup', 'previous-package'])(
    'failure at %s leaves the live application unchanged',
    async (failure) => {
      const f = await fixture();
      if (failure === 'checksum') f.config.digest = '0'.repeat(64);
      if (failure === 'extraction')
        f.options.extract = async () => {
          throw new Error('unzip failed');
        };
      if (failure === 'dependencies')
        f.options.dependencies = async () => {
          throw new Error('npm failed');
        };
      if (failure === 'backup')
        f.options.backup = async () => {
          throw new Error('backup failed');
        };
      if (failure === 'previous-package')
        f.options.execute = async () => {
          throw new Error('archive failed');
        };
      await expect(applyRelease(f.config, f.transaction, f.options)).rejects.toThrow();
      expect(await readFile(path.join(f.root, 'dist/server.js'), 'utf8')).toBe('old dist/server.js');
      expect(f.events).not.toContain('promotion');
      await expect(readFile(path.join(f.root, 'tmp/restart.txt'))).rejects.toThrow();
    },
  );
  it('transfer failure never invokes apply, cleanup still runs and reports the failed stage', async () => {
    const f = await fixture();
    await write(f.directory, 'release.zip', archive());
    const actions = [];
    const execute = async (tool, args) => {
      if (tool === 'git') return sha;
      if (tool === 'scp') throw new Error('transfer interrupted');
      const action = args.at(-1).split(' ').at(-2);
      actions.push(action);
      return JSON.stringify({ stage: '/tmp/rodzina-stage', id: f.transaction.id });
    };
    await expect(deploy({ env, execute, repository: f.directory, fetcher: http })).rejects.toThrow('transfer');
    expect(actions).toEqual(['prepare', 'cleanup']);
    expect(await readFile(path.join(f.root, 'dist/server.js'), 'utf8')).toBe('old dist/server.js');
  });
  it('refuses invalid configuration or mismatched checkout before connecting', async () => {
    const execute = vi.fn();
    await expect(deploy({ env: { ...env, GITHUB_REF: 'refs/heads/feature' }, execute })).rejects.toThrow('main');
    expect(execute).not.toHaveBeenCalled();
    const f = await fixture();
    await write(f.directory, 'release.zip', archive());
    execute.mockResolvedValue('b'.repeat(40));
    await expect(deploy({ env, execute, repository: f.directory })).rejects.toThrow('Checkout SHA');
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('bounded HTTP verification', () => {
  it('retries health, HTML and unauthenticated access, then fails without database rollback', async () => {
    const pause = vi.fn();
    for (const broken of ['/api/health', '/', '/api/auth/me']) {
      const fetcher = vi.fn(async (url) => (new URL(url).pathname === broken ? new Response('{}') : http(url)));
      await expect(checkSite(null, { fetcher, pause, attempts: 2 })).rejects.toThrow('Post-restart');
    }
    expect(pause).toHaveBeenCalledTimes(3);
    await checkSite(null, { fetcher: http, pause });
  });
  it('verifies published APK bytes before and after deploy and rejects unsafe URLs or modified APK', async () => {
    const bytes = Buffer.from('published signed APK');
    const metadata = {
      versionCode: 2,
      versionName: '1.0.1',
      apkUrl: 'https://rodzina.preficze.pl/downloads/android/rodzina-2.apk',
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    const fetcher = async (url) =>
      url.endsWith('latest.json') ? Response.json(metadata) : url.endsWith('.apk') ? new Response(bytes) : http(url);
    const before = await androidState(fetcher);
    await checkSite(before, { fetcher, attempts: 1 });
    metadata.sha256 = '0'.repeat(64);
    await expect(androidState(fetcher)).rejects.toThrow('checksum');
    metadata.apkUrl = 'https://evil.example/downloads/android/rodzina-2.apk';
    await expect(androidState(fetcher)).rejects.toThrow('metadata');
  });
});
