// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildAndroid, nextVersion, signingConfig } from './android-ci.mjs';
import {
  applyRelease,
  checkAndroidTransfer,
  configureAndroidDownloads,
  preflight,
  publishAndroid,
} from './deploy-remote.mjs';
import { deploy, validateArchive } from './deploy.mjs';
import { zipSync } from 'fflate';

const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const certificate = 'a'.repeat(64);
const secrets = {
  GITHUB_REF: 'refs/heads/main',
  ANDROID_KEYSTORE_BASE64: Buffer.from('test keystore').toString('base64'),
  ANDROID_STORE_PASSWORD: 'test-store-password',
  ANDROID_KEY_PASSWORD: 'test-key-password',
  ANDROID_KEY_ALIAS: 'rodzina',
  ANDROID_CERTIFICATE_SHA256: certificate,
};
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'rodzina-android-publication-'));
  directories.push(root);
  const stage = path.join(root, 'stage');
  const downloads = path.join(root, 'downloads');
  await mkdir(stage);
  await mkdir(downloads);
  const bytes = Buffer.from('signed APK');
  const release = {
    versionCode: 2,
    versionName: '1.0.0-deploy.2',
    apkUrl: 'https://rodzina.preficze.pl/downloads/android/rodzina-2-1.0.0-deploy.2.apk',
    sha256: sha(bytes),
  };
  const android = { release, certificate, size: bytes.length, before: null };
  await writeFile(path.join(stage, 'android.apk'), bytes);
  return {
    root,
    stage,
    downloads,
    bytes,
    release,
    config: { downloads, android },
    transaction: { stage, id: randomUUID() },
  };
}

describe('CI signing and automatic versioning', () => {
  it('increments beyond both the repository and published APK without editing committed version', () => {
    expect(nextVersion('versionCode=1\nversionName=1.0.0\n', null)).toEqual({
      versionCode: 2,
      versionName: '1.0.0-deploy.2',
    });
    expect(nextVersion('versionCode=1\nversionName=1.0.0\n', { versionCode: 8 }).versionCode).toBe(9);
    expect(() => nextVersion('versionCode=1\nversionName=1.0.0', { versionCode: 2100000000 })).toThrow();
  });
  it('rejects missing secrets, malformed base64 and invalid fingerprint', () => {
    for (const key of Object.keys(secrets).filter((key) => key !== 'GITHUB_REF'))
      expect(() => signingConfig({ ...secrets, [key]: '' })).toThrow(key);
    expect(() => signingConfig({ ...secrets, ANDROID_KEYSTORE_BASE64: '*invalid*' })).toThrow('BASE64');
    expect(() => signingConfig({ ...secrets, ANDROID_CERTIFICATE_SHA256: 'bad' })).toThrow('SHA256');
  });
  it.each(['success', 'build-failure', 'wrong-certificate'])(
    'cleans the temporary key and restores version after %s',
    async (outcome) => {
      const f = await fixture();
      await mkdir(path.join(f.root, 'android'));
      const original = 'versionCode=1\nversionName=1.0.0\n';
      await writeFile(path.join(f.root, 'android/version.properties'), original);
      let key;
      const build = async (script, args, env) => {
        key = env.RODZINA_ANDROID_KEYSTORE;
        expect(await readFile(key, 'utf8')).toBe('test keystore');
        expect(path.relative(f.root, key).startsWith('..')).toBe(true);
        expect(env.ANDROID_KEYSTORE_BASE64).toBeUndefined();
        expect(env.RODZINA_ANDROID_STORE_PASSWORD).toBe(secrets.ANDROID_STORE_PASSWORD);
        if (outcome === 'build-failure') throw new Error('build failed');
        if (script.endsWith('package-android.mjs')) {
          const output = path.join(f.root, 'android-releases/2-1.0.0-deploy.2');
          await mkdir(output, { recursive: true });
          await writeFile(
            path.join(output, 'certificate-sha256.txt'),
            outcome === 'wrong-certificate' ? 'b'.repeat(64) : certificate,
          );
          await writeFile(path.join(output, 'latest.json'), JSON.stringify(f.release));
          await writeFile(path.join(output, path.basename(f.release.apkUrl)), f.bytes);
        }
      };
      const promise = buildAndroid({
        env: secrets,
        root: f.root,
        build,
        fetcher: async () => new Response('', { status: 404 }),
      });
      if (outcome === 'success') await promise;
      else await expect(promise).rejects.toThrow();
      expect(await readFile(path.join(f.root, 'android/version.properties'), 'utf8')).toBe(original);
      await expect(readFile(key)).rejects.toThrow();
    },
  );
});

describe('atomic APK publication', () => {
  it.skipIf(Number(process.versions.node.split('.')[0]) !== 24)(
    'preflights first publication without mutating production and rejects overlapping storage',
    async () => {
      const f = await fixture();
      const app = path.join(f.root, 'app');
      for (const name of ['public', 'dist/jobs', 'drizzle', 'node_modules', 'backups', 'bin'])
        await mkdir(path.join(app, name), { recursive: true });
      for (const [name, value] of Object.entries({
        'server.cjs': '',
        'package.json': '{"name":"rodzina-release"}',
        'dist/jobs/backup-db.js': '',
        'dist/jobs/migrate-db.js': '',
        'bin/node': '',
        'bin/npm': '',
        'production.db': '',
      }))
        await writeFile(path.join(app, name), value);
      const envFile = path.join(app, '.env');
      const environment = {
        NODE_ENV: 'production',
        RODZINA_PUBLIC_URL: 'https://rodzina.preficze.pl',
        RODZINA_DATABASE_PATH: path.join(app, 'production.db'),
        RODZINA_BACKUP_DIR: path.join(app, 'backups'),
      };
      await writeFile(
        envFile,
        Object.entries(environment)
          .map(([key, value]) => `${key}=${value}`)
          .join('\n'),
      );
      const config = {
        ...f.config,
        root: app,
        node: path.join(app, 'bin/node'),
        runtimeNode: path.join(app, 'bin/node'),
        envFile,
      };
      const checked = await preflight(config, { environment, execute: async () => {} });
      expect(checked.downloads).toBe(`${app}-android`);
      expect(checked.configureDownloads).toBe(true);
      await expect(readdir(checked.downloads)).rejects.toThrow();
      expect(await readFile(envFile, 'utf8')).not.toContain('ANDROID_DOWNLOAD');
      await writeFile(envFile, `RODZINA_ANDROID_DOWNLOAD_DIR=${app}\n`);
      await expect(
        preflight(config, {
          environment: { ...environment, RODZINA_ANDROID_DOWNLOAD_DIR: app },
          execute: async () => {},
        }),
      ).rejects.toThrow('Unsafe persistent');
    },
  );
  it('refuses a corrupt APK before backup and code promotion', async () => {
    const f = await fixture();
    await writeFile(path.join(f.stage, 'android.apk'), 'corrupt');
    const backup = vi.fn();
    await expect(applyRelease({ ...f.config, root: f.root }, f.transaction, { backup })).rejects.toThrow('checksum');
    expect(backup).not.toHaveBeenCalled();
  });
  it('provisions the first download directory and preserves other env settings', async () => {
    const f = await fixture();
    const envFile = path.join(f.root, '.env');
    const downloads = path.join(f.root, 'first-downloads');
    await writeFile(envFile, 'NODE_ENV=production\n# keep this\nRODZINA_ANDROID_DOWNLOAD_DIR=""\nOTHER="private"\n');
    await configureAndroidDownloads({ envFile, downloads, configureDownloads: true });
    expect(await readFile(envFile, 'utf8')).toContain('OTHER="private"');
    expect(await readFile(envFile, 'utf8')).toContain('# keep this');
    expect(await readFile(envFile, 'utf8')).toContain(`RODZINA_ANDROID_DOWNLOAD_DIR=${downloads}`);
    expect(await readdir(downloads)).toEqual([]);
    await expect(configureAndroidDownloads({ envFile, downloads, configureDownloads: true })).rejects.toThrow(
      'changed',
    );
  });
  it('publishes APK before latest.json and retains earlier versions', async () => {
    const f = await fixture();
    await writeFile(path.join(f.downloads, 'rodzina-1-1.0.0.apk'), 'old APK');
    const stages = [];
    await publishAndroid(f.config, f.transaction, { mark: (phase) => stages.push(phase) });
    expect(stages).toEqual(['android-checksum', 'android-apk', 'android-metadata']);
    expect(JSON.parse(await readFile(path.join(f.downloads, 'latest.json'), 'utf8'))).toEqual(f.release);
    expect(await readFile(path.join(f.downloads, path.basename(f.release.apkUrl)))).toEqual(f.bytes);
    expect(await readFile(path.join(f.downloads, 'rodzina-1-1.0.0.apk'), 'utf8')).toBe('old APK');
    expect((await readdir(f.downloads)).some((name) => name.startsWith('.upload'))).toBe(false);
  });
  it('compares metadata by value and accepts an existing colon-separated certificate', async () => {
    const f = await fixture();
    const previous = { ...f.release, versionCode: 1 };
    f.config.android.before = JSON.stringify(previous);
    await writeFile(
      path.join(f.downloads, 'latest.json'),
      JSON.stringify({
        sha256: previous.sha256,
        apkUrl: previous.apkUrl,
        versionName: previous.versionName,
        versionCode: previous.versionCode,
      }),
    );
    await writeFile(
      path.join(f.downloads, 'certificate-sha256.txt'),
      certificate.toUpperCase().match(/.{2}/g).join(':'),
    );
    await publishAndroid(f.config, f.transaction);
    expect(JSON.parse(await readFile(path.join(f.downloads, 'latest.json'), 'utf8'))).toEqual(f.release);
  });
  it('keeps the previous metadata when publication fails after copying the APK', async () => {
    const f = await fixture();
    const previous = { ...f.release, versionCode: 1 };
    f.config.android.before = JSON.stringify(previous);
    await writeFile(path.join(f.downloads, 'latest.json'), JSON.stringify(previous));
    await expect(
      publishAndroid(f.config, f.transaction, {
        mark: (phase) => {
          if (phase === 'android-metadata') throw new Error('simulated publication failure');
        },
      }),
    ).rejects.toThrow('simulated');
    expect(JSON.parse(await readFile(path.join(f.downloads, 'latest.json'), 'utf8'))).toEqual(previous);
    expect((await readdir(f.downloads)).some((name) => name.startsWith('.upload'))).toBe(false);
  });
  it.each(['transfer', 'certificate', 'baseline', 'version', 'immutable'])(
    'rejects %s errors without replacing metadata',
    async (kind) => {
      const f = await fixture();
      const previous = { ...f.release, versionCode: 1 };
      await writeFile(path.join(f.downloads, 'latest.json'), JSON.stringify(previous));
      f.config.android.before = JSON.stringify(previous);
      if (kind === 'transfer') await writeFile(path.join(f.stage, 'android.apk'), 'bad');
      if (kind === 'certificate') await writeFile(path.join(f.downloads, 'certificate-sha256.txt'), 'b'.repeat(64));
      if (kind === 'baseline') f.config.android.before = null;
      if (kind === 'version') {
        previous.versionCode = 2;
        await writeFile(path.join(f.downloads, 'latest.json'), JSON.stringify(previous));
        f.config.android.before = JSON.stringify(previous);
      }
      if (kind === 'immutable') await writeFile(path.join(f.downloads, path.basename(f.release.apkUrl)), 'existing');
      await expect(publishAndroid(f.config, f.transaction)).rejects.toThrow();
      expect(JSON.parse(await readFile(path.join(f.downloads, 'latest.json'), 'utf8'))).toEqual(previous);
    },
  );
  it('rejects traversal and oversized files before reading or publishing', async () => {
    const f = await fixture();
    f.config.android.release.apkUrl = 'https://evil.example/secret.apk';
    await expect(checkAndroidTransfer(f.config, f.transaction)).rejects.toThrow('URL');
    f.config.android.release.apkUrl = f.release.apkUrl;
    f.config.android.size = 201 * 1024 * 1024;
    await expect(checkAndroidTransfer(f.config, f.transaction)).rejects.toThrow();
  });
});

it.each(['success', 'transfer-failure', 'unhealthy-server'])(
  'deploy coordinates Android only after server checks: %s',
  async (outcome) => {
    const f = await fixture();
    const files = {
      'package.json': '{"name":"rodzina-release"}',
      'package-lock.json': JSON.stringify({
        name: 'rodzina-release',
        lockfileVersion: 3,
        packages: { '': { name: 'rodzina-release' } },
      }),
      'server.cjs': '',
      'dist/server.js': '',
      'dist/jobs/backup-db.js': '',
      'dist/jobs/migrate-db.js': '',
      'public/index.html': '',
      'drizzle/meta/_journal.json': '',
    };
    const archive = zipSync(
      Object.fromEntries(Object.entries(files).map(([name, value]) => [name, Buffer.from(value)])),
    );
    validateArchive(archive);
    await writeFile(path.join(f.root, 'release.zip'), archive);
    await writeFile(path.join(f.stage, 'latest.json'), JSON.stringify(f.release));
    await writeFile(path.join(f.stage, 'certificate-sha256.txt'), certificate);
    await writeFile(path.join(f.stage, path.basename(f.release.apkUrl)), f.bytes);
    const actions = [];
    let applied = false;
    let published = false;
    const execute = vi.fn(async (tool, args) => {
      if (tool === 'git') return 'a'.repeat(40);
      if (tool === 'scp') {
        if (outcome === 'transfer-failure' && args.at(-1).endsWith('/android.apk')) throw new Error('interrupted');
        return '';
      }
      const action = args.at(-1).split(' ').at(-2);
      actions.push(action);
      if (action === 'prepare') return JSON.stringify({ stage: '/tmp/rodzina-stage', id: f.transaction.id });
      if (action === 'apply') applied = true;
      if (action === 'publish-android') {
        expect(applied).toBe(true);
        published = true;
      }
      return '';
    });
    const env = {
      GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: 'a'.repeat(40),
      DEPLOY_HOST: 'hosting.example.com',
      DEPLOY_USER: 'owner',
      DEPLOY_PATH: '/home/owner/rodzina',
      DEPLOY_NODE: '/home/owner/nodevenv/rodzina/24/bin/node',
      DEPLOY_ENV_FILE: '/home/owner/data/.env',
      DEPLOY_SSH_KEY: 'test-key',
      DEPLOY_KNOWN_HOSTS: 'test-host',
      DEPLOY_ANDROID_RELEASE: path.join(f.stage, 'latest.json'),
    };
    const fetcher = async (url) => {
      if (url.endsWith('latest.json')) return published ? Response.json(f.release) : new Response('', { status: 404 });
      if (url.endsWith('.apk')) return new Response(f.bytes);
      if (url.endsWith('/api/health')) return Response.json({ ok: outcome !== 'unhealthy-server', dbOk: true });
      if (url.endsWith('/api/auth/me')) return new Response('', { status: 401 });
      return new Response('<div id="root"></div>');
    };
    const promise = deploy({ env, repository: f.root, execute, fetcher, pause: async () => {} });
    if (outcome === 'success') {
      await promise;
      expect(actions).toEqual(['prepare', 'apply', 'publish-android', 'cleanup']);
    } else {
      await expect(promise).rejects.toThrow();
      expect(actions).not.toContain('publish-android');
    }
  },
);
