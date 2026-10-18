import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { androidState } from './deploy.mjs';

export function nextVersion(properties, previous) {
  const values = Object.fromEntries(
    properties
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split('=')),
  );
  const base = Number(values.versionCode);
  const versionCode = Math.max(base + 1, (previous?.versionCode ?? 0) + 1);
  const versionName = `${values.versionName.replace(/-deploy\.\d+$/, '')}-deploy.${versionCode}`;
  if (
    !Number.isSafeInteger(base) ||
    base < 1 ||
    versionCode > 2100000000 ||
    !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(versionName) ||
    versionName.length > 80
  )
    throw new Error('Invalid Android version or exhausted versionCode.');
  return { versionCode, versionName };
}

export function signingConfig(env) {
  for (const name of [
    'ANDROID_KEYSTORE_BASE64',
    'ANDROID_STORE_PASSWORD',
    'ANDROID_KEY_PASSWORD',
    'ANDROID_KEY_ALIAS',
    'ANDROID_CERTIFICATE_SHA256',
  ]) {
    if (!env[name]?.trim()) throw new Error(`Missing ${name}. Configure Actions signing according to docs/DEPLOY.md.`);
  }
  const encoded = env.ANDROID_KEYSTORE_BASE64.replace(/\s/g, '');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > 1024 * 1024 || bytes.toString('base64') !== encoded)
    throw new Error('Invalid ANDROID_KEYSTORE_BASE64.');
  const fingerprint = env.ANDROID_CERTIFICATE_SHA256.replace(/:/g, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Invalid ANDROID_CERTIFICATE_SHA256.');
  return { bytes, fingerprint };
}

async function execute(script, args, env, root) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: root, env, stdio: 'inherit', windowsHide: true });
    child.once('error', () => reject(new Error('Cannot start Android build.')));
    child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error('Android build failed.'))));
  });
}

export async function buildAndroid({
  env = process.env,
  fetcher = fetch,
  root = fileURLToPath(new URL('../', import.meta.url)),
  build = execute,
} = {}) {
  if (env.GITHUB_REF !== 'refs/heads/main') throw new Error('Android deploy requires main.');
  const signing = signingConfig(env);
  const baseline = await androidState(fetcher, { allowLegacySpa: true });
  const previous = baseline && baseline !== 'legacy-spa' ? JSON.parse(baseline) : null;
  const versionFile = path.join(root, 'android/version.properties');
  const original = await readFile(versionFile, 'utf8');
  const version = nextVersion(original, previous);
  const directory = await mkdtemp(path.join(tmpdir(), 'rodzina-android-signing-'));
  try {
    const keystore = path.join(directory, 'release.jks');
    await writeFile(keystore, signing.bytes, { mode: 0o600, flag: 'wx' });
    signing.bytes.fill(0);
    await writeFile(versionFile, `versionCode=${version.versionCode}\nversionName=${version.versionName}\n`);
    const buildEnv = {
      ...env,
      RODZINA_ANDROID_KEYSTORE: keystore,
      RODZINA_ANDROID_STORE_PASSWORD: env.ANDROID_STORE_PASSWORD,
      RODZINA_ANDROID_KEY_PASSWORD: env.ANDROID_KEY_PASSWORD,
      RODZINA_ANDROID_KEY_ALIAS: env.ANDROID_KEY_ALIAS,
    };
    for (const name of ['ANDROID_KEYSTORE_BASE64', 'ANDROID_STORE_PASSWORD', 'ANDROID_KEY_PASSWORD'])
      delete buildEnv[name];
    await build(path.join(root, 'scripts/android.mjs'), ['release'], buildEnv, root);
    await build(path.join(root, 'scripts/package-android.mjs'), [], buildEnv, root);
    const source = path.join(root, 'android-releases', `${version.versionCode}-${version.versionName}`);
    const fingerprint = (await readFile(path.join(source, 'certificate-sha256.txt'), 'utf8')).trim();
    if (fingerprint.replace(/:/g, '').toLowerCase() !== signing.fingerprint)
      throw new Error('APK signing certificate differs from ANDROID_CERTIFICATE_SHA256.');
    const destination = path.join(root, 'android-releases/deploy');
    await mkdir(destination);
    for (const name of [
      'latest.json',
      'certificate-sha256.txt',
      `rodzina-${version.versionCode}-${version.versionName}.apk`,
    ])
      await copyFile(path.join(source, name), path.join(destination, name));
    console.log(`Signed Android release ready: ${version.versionName} (${version.versionCode}).`);
  } finally {
    signing.bytes.fill(0);
    try {
      await writeFile(versionFile, original);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  buildAndroid().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
