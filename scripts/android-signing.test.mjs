// @vitest-environment node
import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const jdk = process.env.JAVA_HOME ?? path.join(root, '.android-tools/jdk/jdk-21.0.12.1+1');
const keytool = path.join(jdk, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool');

it.skipIf(!existsSync(keytool))(
  'distinguishes store password, alias and private key password without disclosing credentials',
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'rodzina-signing-check-'));
    const storePassword = randomBytes(16).toString('hex');
    const keyPassword = `Key-żąć!-${randomBytes(12).toString('hex')}`;
    const env = {
      ...process.env,
      JAVA_HOME: jdk,
      RODZINA_ANDROID_KEYSTORE: path.join(directory, 'test.jks'),
      RODZINA_ANDROID_KEY_ALIAS: 'test-only',
      RODZINA_ANDROID_STORE_PASSWORD: storePassword,
      RODZINA_ANDROID_KEY_PASSWORD: keyPassword,
    };
    try {
      const created = spawnSync(
        keytool,
        [
          '-genkeypair',
          '-keystore',
          env.RODZINA_ANDROID_KEYSTORE,
          '-storetype',
          'JKS',
          '-alias',
          'test-only',
          '-keyalg',
          'RSA',
          '-keysize',
          '2048',
          '-validity',
          '1',
          '-dname',
          'CN=Disposable Signing Check',
          '-storepass:env',
          'RODZINA_ANDROID_STORE_PASSWORD',
          '-keypass:env',
          'RODZINA_ANDROID_KEY_PASSWORD',
          '-noprompt',
        ],
        { env, encoding: 'utf8' },
      );
      expect(created.status).toBe(0);
      for (const [patch, status, message] of [
        [{}, 0, 'sprawdzone poprawnie'],
        [{ RODZINA_ANDROID_STORE_PASSWORD: 'incorrect-store-password' }, 1, 'RODZINA_ANDROID_STORE_PASSWORD'],
        [{ RODZINA_ANDROID_KEY_PASSWORD: 'incorrect-key-password' }, 1, 'RODZINA_ANDROID_KEY_PASSWORD'],
        [{ RODZINA_ANDROID_KEY_ALIAS: 'missing-alias' }, 1, 'RODZINA_ANDROID_KEY_ALIAS'],
      ]) {
        const result = spawnSync(process.execPath, ['scripts/android.mjs', 'check-signing'], {
          cwd: root,
          env: { ...env, ...patch },
          encoding: 'utf8',
        });
        expect(result.status).toBe(status);
        const output = result.stdout + result.stderr;
        expect(output).toContain(message);
        expect(output).not.toContain(storePassword);
        expect(output).not.toContain(keyPassword);
        for (const value of Object.values(patch)) expect(output).not.toContain(value);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  30000,
);
