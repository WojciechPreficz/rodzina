// @vitest-environment node
import { createServer } from 'vite';
import { expect, it } from 'vitest';
import { landingPage } from './landing-page.js';

it('serves the landing in development with same-origin forms and a strict asset allowlist', async () => {
  const server = await createServer({
    configFile: false,
    plugins: [landingPage()],
    server: { host: '127.0.0.1', port: 0 },
  });
  try {
    await server.listen();
    const base = server.resolvedUrls?.local[0];
    if (!base) throw new Error('Missing development server URL');
    const redirect = await fetch(new URL('/strona?source=test', base), { redirect: 'manual' });
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toBe('/strona/?source=test');
    const page = await fetch(new URL('/strona/', base));
    const html = await page.text();
    expect(html).toContain('Mniej pamiętania.');
    for (const path of ['/register', '/login', '/login-child']) expect(html).toContain(`href="${path}"`);
    expect(html).not.toContain('Prototyp strony');
    const config = await fetch(new URL('/strona/config.js', base));
    expect(config.headers.get('content-type')).toContain('javascript');
    expect(await config.text()).toBe('window.APP_BASE_URL = window.location.origin;\n');
    for (const name of ['server.mjs', 'playwright.config.mjs', 'missing.css']) {
      expect((await fetch(new URL(`/strona/${name}`, base))).status).toBe(404);
    }
  } finally {
    await server.close();
  }
});
