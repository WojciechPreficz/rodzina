// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';

it('shares an API budget across routes, isolates IPs and resets the budget after the window', async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    RODZINA_DATABASE_PATH: ':memory:',
    RODZINA_API_RATE_LIMIT_MAX: '2',
    RODZINA_API_RATE_LIMIT_WINDOW_MS: '10000',
  });
  const database = createDatabase(config);
  const app = await buildApp(config, database);
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  const get = (url: string, remoteAddress = '192.0.2.1', headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url, remoteAddress, headers });

  try {
    const first = await get('/api/health');
    expect(first.statusCode).toBe(200);
    expect(first.headers['x-ratelimit-remaining']).toBe('1');
    expect((await get('/api/auth/me')).statusCode).toBe(401);

    const blocked = await get('/api/missing?check=1', '192.0.2.1', { 'x-forwarded-for': '192.0.2.2' });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Zbyt wiele żądań. Spróbuj ponownie później.' },
    });
    expect(blocked.headers).toMatchObject({
      'x-ratelimit-limit': '2',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '10',
      'retry-after': '10',
    });
    expect((await get('/api/health', '192.0.2.2')).statusCode).toBe(200);
    for (const ip of ['2001:db8::1', '2001:db8::2']) {
      const response = await get('/api/health', ip);
      expect(response.headers['x-ratelimit-remaining']).toBe('1');
    }
    const web = await get('/.well-known/assetlinks.json');
    expect(web.statusCode).toBe(200);
    expect(web.headers['x-ratelimit-limit']).toBeUndefined();

    clock.mockReturnValue(now + 10_001);
    expect((await get('/api/health')).statusCode).toBe(200);
  } finally {
    clock.mockRestore();
    await app.close();
    database.sqlite.close();
  }
});
