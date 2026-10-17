import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundled = path.join(root, '.android-tools/jdk/jdk-21.0.12.1+1');
const javaHome = process.env.JAVA_HOME ?? (existsSync(bundled) ? bundled : undefined);
const java = javaHome ? path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java';
const env = {
  ...process.env,
  ...(javaHome ? { JAVA_HOME: javaHome } : {}),
  RODZINA_ANDROID_KEYSTORE:
    process.env.RODZINA_ANDROID_KEYSTORE ?? path.join(homedir(), 'rodzina-signing/rodzina-release.jks'),
  RODZINA_ANDROID_KEY_ALIAS: process.env.RODZINA_ANDROID_KEY_ALIAS ?? 'rodzina',
};
delete env.RODZINA_ANDROID_STORE_PASSWORD;
delete env.RODZINA_ANDROID_KEY_PASSWORD;
const result = spawnSync(
  java,
  [
    path.join(root, 'scripts/CheckAndroidSigning.java'),
    '--build',
    process.execPath,
    path.join(root, 'scripts/android.mjs'),
    path.join(root, 'scripts/package-android.mjs'),
  ],
  { cwd: root, env, stdio: 'inherit' },
);
if (result.error) throw new Error('Nie można uruchomić JDK. Sprawdź JAVA_HOME.');
process.exit(result.status ?? 1);
