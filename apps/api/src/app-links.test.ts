import { expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createDatabase } from './db/client.js';
import { loadConfig } from './config.js';

it('serves public JSON association only for configured APK certificate fingerprints', async () => {
  for (const fingerprint of ['', Array(32).fill('AB').join(':')]) {
    const config = loadConfig({
      NODE_ENV: 'test',
      RODZINA_DATABASE_PATH: ':memory:',
      RODZINA_ANDROID_SHA256_CERT_FINGERPRINTS: fingerprint,
    });
    const database = createDatabase(config);
    const app = await buildApp(config, database);
    try {
      const response = await app.inject({ method: 'GET', url: '/.well-known/assetlinks.json' });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.json()).toEqual(
        fingerprint
          ? [
              {
                relation: ['delegate_permission/common.handle_all_urls'],
                target: {
                  namespace: 'android_app',
                  package_name: 'pl.preficze.rodzina',
                  sha256_cert_fingerprints: [fingerprint],
                },
              },
            ]
          : [],
      );
    } finally {
      await app.close();
      database.sqlite.close();
    }
  }
});
it('rejects malformed certificates and accepts multiple public SHA-256 fingerprints', () => {
  expect(() => loadConfig({ RODZINA_ANDROID_SHA256_CERT_FINGERPRINTS: 'placeholder' })).toThrow();
  const fingerprint = Array(32).fill('ab').join(':');
  expect(
    loadConfig({ RODZINA_ANDROID_SHA256_CERT_FINGERPRINTS: `${fingerprint}, ${fingerprint}` })
      .RODZINA_ANDROID_SHA256_CERT_FINGERPRINTS,
  ).toEqual([fingerprint.toUpperCase(), fingerprint.toUpperCase()]);
});
