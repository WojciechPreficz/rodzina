import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAndroidRelease } from '../packages/shared/dist/index.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = Object.fromEntries(
  (await readFile(path.join(root, 'android/version.properties'), 'utf8'))
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split('=')),
);
const code = Number(version.versionCode);
const name = version.versionName;
const apk = path.join(root, 'android/app/build/outputs/apk/release/app-release.apk');
const sdk = process.env.ANDROID_HOME ?? path.join(root, '.android-tools/sdk');
const tools = (await readdir(path.join(sdk, 'build-tools')))
  .filter((entry) => /^\d+\.\d+\.\d+$/.test(entry))
  .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
if (!tools) throw new Error('Android build-tools not found.');
const javaHome = process.env.JAVA_HOME ?? path.join(root, '.android-tools/jdk/jdk-21.0.12.1+1');
function inspect(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', cwd: root });
  if (result.error || result.status !== 0)
    throw new Error('APK verification failed. Check JDK/SDK and signing configuration.');
  return result.stdout;
}
const buildTools = path.join(sdk, 'build-tools', tools);
const signature = inspect(path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), [
  '-jar',
  path.join(buildTools, 'lib/apksigner.jar'),
  'verify',
  '--verbose',
  '--print-certs',
  apk,
]);
if (/CN=Android Debug/i.test(signature)) throw new Error('A debug key cannot be used for a published release.');
const badging = inspect(path.join(buildTools, process.platform === 'win32' ? 'aapt.exe' : 'aapt'), [
  'dump',
  'badging',
  apk,
]);
if (
  !badging.includes(`package: name='pl.preficze.rodzina' versionCode='${code}' versionName='${name}'`) ||
  badging.includes('application-debuggable')
)
  throw new Error('APK identity/version does not match version.properties or APK is debuggable.');
const bytes = await readFile(apk);
const filename = `rodzina-${code}-${name}.apk`;
const release = parseAndroidRelease(
  {
    versionCode: code,
    versionName: name,
    apkUrl: `https://rodzina.preficze.pl/downloads/android/${filename}`,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  },
  'https://rodzina.preficze.pl',
);
const destination = path.join(root, 'android-releases', `${code}-${name}`);
await mkdir(path.dirname(destination), { recursive: true });
await mkdir(destination); // Never overwrite an immutable published release.
await copyFile(apk, path.join(destination, filename));
await writeFile(path.join(destination, 'latest.json'), JSON.stringify(release, null, 2) + '\n', { flag: 'wx' });
const fingerprint = signature.match(/certificate SHA-256 digest: ([a-f0-9]{64})/i)?.[1];
if (fingerprint)
  await writeFile(
    path.join(destination, 'certificate-sha256.txt'),
    fingerprint.toUpperCase().match(/.{2}/g).join(':') + '\n',
  );
console.log(
  `Verified signed release prepared in android-releases/${code}-${name}. Upload APK completely before replacing latest.json. Back up your signing key separately.`,
);
