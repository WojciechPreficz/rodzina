import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { realpath } from 'node:fs/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2];
if (!['sync', 'debug', 'release', 'check-signing'].includes(mode))
  throw new Error('Expected sync, debug, release or check-signing.');
if (!process.env.JAVA_HOME) {
  const bundledJdk = path.join(root, '.android-tools/jdk/jdk-21.0.12.1+1');
  if (existsSync(bundledJdk)) process.env.JAVA_HOME = bundledJdk;
}
if (!process.env.ANDROID_HOME && existsSync(path.join(root, '.android-tools/sdk')))
  process.env.ANDROID_HOME = path.join(root, '.android-tools/sdk');
if (!process.env.GRADLE_USER_HOME && existsSync(path.join(root, '.android-tools/gradle')))
  process.env.GRADLE_USER_HOME = path.join(root, '.android-tools/gradle');
if (mode === 'release' || mode === 'check-signing') {
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
  const java = process.env.JAVA_HOME
    ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    : 'java';
  const checked = spawnSync(java, [path.join(root, 'scripts/CheckAndroidSigning.java')], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    timeout: 30000,
  });
  if (checked.error) throw new Error('Nie można uruchomić kontroli klucza. Sprawdź JAVA_HOME (JDK 21).');
  if (checked.status !== 0) {
    const errors = {
      SIGNING_STORE_PASSWORD_INVALID:
        'Java nie otworzyła keystore hasłem ze zmiennej RODZINA_ANDROID_STORE_PASSWORD. Sprawdź hasło lub sposób jego wczytania w terminalu. Nie twórz klucza ponownie.',
      SIGNING_ALIAS_INVALID: 'Alias RODZINA_ANDROID_KEY_ALIAS nie wskazuje klucza prywatnego w tym keystore.',
      SIGNING_KEY_PASSWORD_INVALID:
        'Keystore został otwarty, ale hasło klucza RODZINA_ANDROID_KEY_PASSWORD jest niepoprawne.',
    };
    const code = Object.keys(errors).find((code) => checked.stderr.includes(code));
    throw new Error(code ? errors[code] : 'Kontrola klucza nie powiodła się. Sprawdź JDK i plik keystore.');
  }
  console.log('Keystore, alias i hasło klucza sprawdzone poprawnie.');
  if (mode === 'check-signing') process.exit(0);
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
  const args = [task, ...(mode === 'release' ? ['--no-daemon', '--no-configuration-cache'] : [])];
  if (process.platform === 'win32') run('cmd.exe', ['/d', '/c', 'gradlew.bat', ...args], path.join(root, 'android'));
  else run('./gradlew', args, path.join(root, 'android'));
}
