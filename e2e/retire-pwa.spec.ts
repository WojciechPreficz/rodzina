import { expect, test, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

async function installLegacyWorker(page: Page) {
  await page.route('**/legacy-setup', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<p>Legacy setup</p>' }),
  );
  // Playwright page routes do not intercept service worker script updates.
  // Serve the old script using the browser context route instead.
  await page.context().route('**/sw.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `self.addEventListener('install', () => self.skipWaiting());
        self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
        self.addEventListener('fetch', event => {
          if (new URL(event.request.url).pathname === '/old-ui') {
            event.respondWith(caches.match('/old-ui'));
          }
        });`,
    }),
  );
  await page.goto('/legacy-setup');
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const cache = await caches.open(`workbox-precache-v2-${location.origin}/`);
    await cache.put('/old-ui', new Response('old UI'));
    await (await caches.open('family-data')).put('/preserved', new Response('keep'));
    localStorage.setItem('retirement-test', 'keep');
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.context().unroute('**/sw.js');
}

async function expectRetired(page: Page) {
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  const result = await page.evaluate(async () => ({
    caches: await caches.keys(),
    local: localStorage.getItem('retirement-test'),
    preserved: await (await caches.match('/preserved'))?.text(),
  }));
  expect(result).toEqual({ caches: ['family-data'], local: 'keep', preserved: 'keep' });
}

test('new visitors get a website without registering a service worker', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Witamy w Rodzinie' })).toBeVisible();
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.status()).toBe(410);
});

test('new frontend retires legacy registration and cache while keeping the session', async ({
  page,
  baseURL,
}, info) => {
  const registered = await page.request.post('/api/auth/register-family', {
    headers: { Origin: baseURL! },
    data: {
      familyName: 'Migracja',
      displayName: 'Anna',
      email: `retirement-${info.project.name}@example.com`,
      password: 'password123',
    },
  });
  expect(registered.ok()).toBe(true);
  await installLegacyWorker(page);
  await page.goto('/wiecej');
  await expect(page.getByText('Anna · Migracja')).toBeVisible();
  await expectRetired(page);
  expect(await page.evaluate(async () => (await fetch('/old-ui')).text())).toContain('<div id="root"></div>');
  expect((await page.request.get('/api/auth/me')).ok()).toBe(true);
  await page.reload();
  await expect(page.getByText('Anna · Migracja')).toBeVisible();
});

test('existing registration can retire itself without loading the new React frontend', async ({ page }) => {
  await installLegacyWorker(page);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    await registration!.update();
  });
  await expectRetired(page);
  // The replacement does not intercept network requests with stale cached UI.
  expect((await page.request.get('/sw.js')).headers()['cache-control']).toBe('no-store');
});
