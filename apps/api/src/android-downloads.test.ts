import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createDatabase } from './db/client.js';
import { loadTestConfig } from './config.test-utils.js';

it('serves public immutable APK and uncached validated metadata; missing/malformed releases never become SPA', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'rodzina-downloads-'));
  const config = loadTestConfig({
    RODZINA_DATABASE_PATH: ':memory:',
    RODZINA_ANDROID_DOWNLOAD_DIR: dir,
    RODZINA_PUBLIC_URL: 'https://rodzina.preficze.pl',
  });
  const database = createDatabase(config);
  const app = await buildApp(config, database);
  const filename = 'rodzina-2-1.0.1.apk';
  const release = {
    versionCode: 2,
    versionName: '1.0.1',
    apkUrl: `https://rodzina.preficze.pl/downloads/android/${filename}`,
    sha256: 'ab'.repeat(32),
  };
  const get = (file: string) => app.inject({ method: 'GET', url: `/downloads/android/${file}` });
  try {
    expect((await get('latest.json')).statusCode).toBe(404);
    await writeFile(path.join(dir, 'latest.json'), JSON.stringify(release));
    expect((await get('latest.json')).statusCode).toBe(404);
    await writeFile(path.join(dir, filename), 'test APK');
    const metadata = await get('latest.json');
    expect(metadata.statusCode).toBe(200);
    expect(metadata.json()).toEqual(release);
    expect(metadata.headers['cache-control']).toBe('no-store');
    const apk = await get(filename);
    expect(apk.statusCode).toBe(200);
    expect(apk.body).toBe('test APK');
    expect(apk.headers['content-type']).toBe('application/vnd.android.package-archive');
    expect(apk.headers['cache-control']).toContain('immutable');
    expect(apk.headers['x-content-type-options']).toBe('nosniff');
    expect((await app.inject({ method: 'HEAD', url: `/downloads/android/${filename}` })).statusCode).toBe(200);
    expect((await get('secret.env')).statusCode).toBe(404);
    await writeFile(
      path.join(dir, 'latest.json'),
      JSON.stringify({ ...release, apkUrl: 'https://evil.example/app.apk' }),
    );
    expect((await get('latest.json')).statusCode).toBe(404);
    await writeFile(path.join(dir, 'latest.json'), '{');
    expect((await get('latest.json')).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me' })).headers['cache-control']).toBe('no-store');
  } finally {
    await app.close();
    database.sqlite.close();
    await rm(dir, { recursive: true, force: true });
  }
});
