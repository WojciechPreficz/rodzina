import { mkdtempSync, rmSync } from 'node:fs';
import webPush from 'web-push';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = path.resolve(tmpdir());
const directory = path.resolve(mkdtempSync(path.join(temporaryRoot, 'rodzina-e2e-')));
if (!directory.startsWith(`${temporaryRoot}${path.sep}`)) throw new Error('Invalid temporary directory');
process.on('exit', () => rmSync(directory, { recursive: true, force: true }));

const vapid = webPush.generateVAPIDKeys();
Object.assign(process.env, {
  NODE_ENV: 'production',
  PORT: '3417',
  RODZINA_DATABASE_PATH: path.join(directory, 'e2e.db'),
  RODZINA_WEB_DIR: path.join(root, 'apps/web/dist'),
  RODZINA_PUBLIC_URL: 'http://127.0.0.1:3417',
  RODZINA_ALLOW_REGISTRATION: 'true',
  RODZINA_ANDROID_DOWNLOAD_DIR: '',
  RODZINA_VAPID_PUBLIC_KEY: vapid.publicKey,
  RODZINA_VAPID_PRIVATE_KEY: vapid.privateKey,
  RODZINA_VAPID_SUBJECT: 'mailto:e2e@example.com',
});
await import('../apps/api/dist/server.js');
