import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { registerSecurityHeaders } from './security-headers.js';

it('allows local OCR WASM and image previews while keeping scripts and workers restricted', async () => {
  const app = Fastify();
  registerSecurityHeaders(
    app,
    loadConfig({ NODE_ENV: 'test', RODZINA_DATABASE_PATH: ':memory:', RODZINA_PUBLIC_URL: 'http://localhost:3000' }),
  );
  app.get('/', () => 'page');
  try {
    const response = await app.inject('/');
    const csp = response.headers['content-security-policy'];
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).toContain("worker-src 'self';");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain('https:');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  } finally {
    await app.close();
  }
});
