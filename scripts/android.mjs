import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2];
if (!['sync', 'debug', 'release'].includes(mode)) throw new Error('Expected sync, debug or release.');
if (!process.env.JAVA_HOME) {
  const bundledJdk = path.join(root, '.android-tools/jdk/jdk-21.0.12.1+1');
  if (existsSync(bundledJdk)) process.env.JAVA_HOME = bundledJdk;
}
if (!process.env.ANDROID_HOME && existsSync(path.join(root, '.android-tools/sdk')))
  process.env.ANDROID_HOME = path.join(root, '.android-tools/sdk');
if (!process.env.GRADLE_USER_HOME && existsSync(path.join(root, '.android-tools/gradle')))
  process.env.GRADLE_USER_HOME = path.join(root, '.android-tools/gradle');
if (mode === 'release') {
  for (const name of ['KEYSTORE', 'STORE_PASSWORD', 'KEY_ALIAS', 'KEY_PASSWORD']) {
    if (!process.env[`RODZINA_ANDROID_${name}`])
      throw new Error(`Missing RODZINA_ANDROID_${name}. See docs/DEPLOY.md.`);
  }
  const store = await realpath(process.env.RODZINA_ANDROID_KEYSTORE);
  const repository = await realpath(root);
  const relative = path.relative(repository, store);
  if (
    !path.isAbsolute(process.env.RODZINA_ANDROID_KEYSTORE) ||
    (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
    throw new Error('Release keystore must be outside the repository.');
  if (
    process.env.RODZINA_ANDROID_API_ORIGIN &&
    process.env.RODZINA_ANDROID_API_ORIGIN !== 'https://rodzina.preficze.pl'
  )
    throw new Error('Release requires the production HTTPS API.');
  process.env.RODZINA_ANDROID_API_ORIGIN = 'https://rodzina.preficze.pl';
}
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'packages/shared/tsconfig.json']);
run(
  process.execPath,
  [path.join(root, 'node_modules/vite/bin/vite.js'), 'build', '--mode', 'android'],
  path.join(root, 'apps/web'),
);
run(process.execPath, ['node_modules/@capacitor/cli/bin/capacitor', 'sync', 'android']);
if (mode !== 'sync') {
  const task = mode === 'release' ? 'assembleRelease' : 'assembleDebug';
  if (process.platform === 'win32') run('cmd.exe', ['/d', '/c', 'gradlew.bat', task], path.join(root, 'android'));
  else run('./gradlew', [task], path.join(root, 'android'));
}
