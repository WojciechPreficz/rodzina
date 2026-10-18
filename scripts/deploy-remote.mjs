import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { access, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const names = ['server.cjs', 'package.json', 'dist', 'public', 'drizzle'];
const inside = (parent, candidate) => candidate === parent || candidate.startsWith(`${parent}${path.sep}`);

async function command(executable, args, cwd, env = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: ['ignore', 'ignore', 'ignore'] });
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error('Remote command failed.'))));
  });
}

export async function checkTree(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory()))
      throw new Error('Unsafe application tree.');
    if (entry.name.startsWith('.') || /\.(?:db|sqlite|apk|jks|pem|key)(?:[.-]|$)/i.test(entry.name))
      throw new Error('Protected data in managed application tree.');
    if (entry.isDirectory()) await checkTree(path.join(directory, entry.name));
  }
}

async function checkRestart(root) {
  for (const [name, kind] of [
    ['tmp', 'directory'],
    ['tmp/restart.txt', 'file'],
  ]) {
    try {
      const info = await lstat(path.join(root, name));
      if (info.isSymbolicLink() || (kind === 'directory' ? !info.isDirectory() : !info.isFile()))
        throw new Error('Unsafe restart path.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

export async function preflight(config, { execute = command, environment } = {}) {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Hosting requires Node 24.');
  if ((await realpath(config.root)) !== config.root) throw new Error('Application path must be canonical.');
  if (JSON.parse(await readFile(path.join(config.root, 'package.json'), 'utf8')).name !== 'rodzina-release')
    throw new Error('Target is not the existing Rodzina release.');
  for (const name of names) {
    const info = await lstat(path.join(config.root, name));
    if (info.isSymbolicLink()) throw new Error('Managed path is a symlink.');
    if (info.isDirectory()) await checkTree(path.join(config.root, name));
    else if (!info.isFile()) throw new Error('Invalid managed path.');
  }
  await access(path.join(config.root, 'dist/jobs/backup-db.js'));
  await checkRestart(config.root);
  await access(config.node);
  const npm = await realpath(path.join(path.dirname(config.node), 'npm'));
  // Validate without printing environment values, database contents or credentials.
  if (!environment) process.loadEnvFile(config.envFile);
  const settings = environment ?? process.env;
  if (settings.NODE_ENV !== 'production' || settings.RODZINA_PUBLIC_URL !== 'https://rodzina.preficze.pl')
    throw new Error('Wrong production environment.');
  const resolve = (value) => path.resolve(config.root, value);
  if (resolve(settings.RODZINA_WEB_DIR || 'public') !== path.join(config.root, 'public'))
    throw new Error('RODZINA_WEB_DIR must resolve to application public/.');
  const persistent = [];
  for (const value of [config.envFile, settings.RODZINA_DATABASE_PATH, settings.RODZINA_BACKUP_DIR]) {
    if (!value || !path.isAbsolute(value)) throw new Error('Persistent paths must be absolute.');
    const resolved = await realpath(value);
    persistent.push(resolved);
    if (
      names.some((name) => inside(path.join(config.root, name), resolved)) ||
      inside(path.join(config.root, 'node_modules'), resolved)
    )
      throw new Error('Persistent path overlaps application files.');
  }
  if (settings.RODZINA_ANDROID_DOWNLOAD_DIR) {
    const downloads = await realpath(settings.RODZINA_ANDROID_DOWNLOAD_DIR);
    persistent.push(downloads);
    if (inside(config.root, downloads) || inside(downloads, config.root))
      throw new Error('APK directory must be outside application.');
  }
  // cPanel may own a node_modules symlink; retain it and operate on its target.
  const modules = await realpath(path.join(config.root, 'node_modules'));
  if (modules === config.root || inside(modules, config.root)) throw new Error('Invalid node_modules target.');
  if (persistent.some((value) => inside(modules, value) || inside(value, modules)))
    throw new Error('Dependencies overlap persistent storage.');
  for (const tool of ['unzip', 'tar']) await execute(tool, ['--help'], config.root);
  await execute(config.node, [npm, '--version'], config.root);
  return { npm, modules };
}

export async function applyRelease(
  config,
  transaction,
  { execute = command, extract, dependencies, backup, mark = () => {} } = {},
) {
  const { root, node, envFile, digest } = config;
  const { stage } = transaction;
  mark('checksum');
  if (
    createHash('sha256')
      .update(await readFile(path.join(stage, 'release.zip')))
      .digest('hex') !== digest
  )
    throw new Error('Transfer checksum mismatch.');
  const unpacked = path.join(stage, 'unpacked');
  await mkdir(unpacked);
  mark('extraction');
  if (extract) await extract(unpacked);
  else await execute('unzip', ['-q', path.join(stage, 'release.zip'), '-d', unpacked], root);
  await checkTree(unpacked);
  const entries = await readdir(unpacked);
  if (entries.length !== names.length || entries.some((name) => !names.includes(name)))
    throw new Error('Unexpected archive roots.');
  if (JSON.parse(await readFile(path.join(unpacked, 'package.json'), 'utf8')).name !== 'rodzina-release')
    throw new Error('Wrong archive.');
  mark('dependencies');
  if (dependencies) await dependencies(unpacked);
  else {
    // Install outside the live application, disabling all lifecycle compilation.
    await execute(
      node,
      [config.npm, 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
      unpacked,
      { ...process.env, PATH: `${path.dirname(node)}:${process.env.PATH}` },
    );
    const require = createRequire(path.join(unpacked, 'package.json'));
    const sqlite = path.dirname(require.resolve('better-sqlite3/package.json'));
    await execute(node, [require.resolve('prebuild-install/bin.js')], sqlite);
    await execute(
      node,
      [
        '--input-type=commonjs',
        '-e',
        "const db = require('better-sqlite3')(':memory:'); db.close(); require('@node-rs/argon2');",
      ],
      unpacked,
    );
  }
  mark('backup');
  if (backup) await backup();
  else await execute(node, [`--env-file=${envFile}`, 'dist/jobs/backup-db.js'], root);
  // The existing job validates configuration and can run migrations. Preserve its
  // completed database snapshot and keep code history outside the public tree.
  mark('previous-package');
  const history = path.join(path.dirname(root), `${path.basename(root)}-deploy-history`);
  await mkdir(history, { recursive: true, mode: 0o700 });
  if ((await lstat(history)).isSymbolicLink()) throw new Error('Unsafe history path.');
  const previous = path.join(history, `${transaction.id}-previous.tar.gz`);
  await execute('tar', ['-czf', previous, ...names], root);
  await cp(path.join(stage, 'release.zip'), path.join(history, `${transaction.id}-release.zip`));
  await writeFile(
    path.join(history, `${transaction.id}.json`),
    JSON.stringify({ sha: config.sha, digest, previous, createdAt: new Date().toISOString() }),
    { mode: 0o600 },
  );
  mark('promotion');
  await checkRestart(root);
  // Overlay only managed files. No deletion of data, old assets or cPanel files.
  // Validate old trees again immediately before writing, including nested links.
  for (const name of ['dist', 'public', 'drizzle']) await checkTree(path.join(root, name));
  await cp(path.join(unpacked, 'node_modules'), config.modules, { recursive: true, verbatimSymlinks: true });
  for (const name of names) await cp(path.join(unpacked, name), path.join(root, name), { recursive: true });
  const restart = path.join(root, 'tmp');
  await mkdir(restart, { recursive: true });
  if ((await lstat(restart)).isSymbolicLink()) throw new Error('Unsafe restart directory.');
  const marker = path.join(restart, 'restart.txt');
  try {
    if (!(await lstat(marker)).isFile()) throw new Error('Unsafe restart marker.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  mark('restart');
  await writeFile(marker, '');
}

export async function remoteMain(action, config) {
  const parent = path.dirname(config.root);
  const lock = path.join(parent, `.${path.basename(config.root)}-deploy-lock`);
  if (action === 'prepare') {
    await preflight(config);
    const id = randomUUID();
    // mkdir is the server-side exclusion lock, shared by workflow and local runs.
    await mkdir(lock, { mode: 0o700 });
    try {
      const stage = await mkdtemp(path.join(parent, '.rodzina-deploy-'));
      await writeFile(path.join(lock, 'transaction.json'), JSON.stringify({ id, stage }), { mode: 0o600 });
      console.log(JSON.stringify({ id, stage }));
    } catch (error) {
      await rm(lock, { recursive: true, force: true });
      throw error;
    }
    return;
  }
  const stored = JSON.parse(await readFile(path.join(lock, 'transaction.json'), 'utf8'));
  if (
    stored.id !== config.id ||
    stored.stage !== config.stage ||
    path.dirname(config.stage) !== parent ||
    !path.basename(config.stage).startsWith('.rodzina-deploy-') ||
    (await lstat(config.stage)).isSymbolicLink()
  )
    throw new Error('Invalid transaction.');
  if (action === 'cleanup') {
    await rm(config.stage, { recursive: true });
    await rm(lock, { recursive: true });
  } else if (action === 'apply') {
    const checked = await preflight(config);
    await applyRelease({ ...config, ...checked }, stored, { mark: (phase) => console.log(`DEPLOY_STAGE=${phase}`) });
  } else throw new Error('Unknown deploy action.');
}

if (process.argv[1] === '-') {
  remoteMain(process.argv[2], JSON.parse(Buffer.from(process.argv[3], 'base64url').toString())).catch(() => {
    console.error('Remote deploy failed. Check the recorded stage and docs/DEPLOY.md.');
    process.exitCode = 1;
  });
}
