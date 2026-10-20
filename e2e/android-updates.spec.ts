import { expect, test } from '@playwright/test';

test('login and More show release availability without broken downloads at both viewport sizes', async ({
  page,
}, testInfo) => {
  await page.goto('/login');
  await expect(page.getByText('Wydanie Androida jest obecnie niedostępne.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pobierz aplikację na Androida' })).toHaveCount(0);
  await page.route('**/downloads/android/latest.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        versionCode: 2,
        versionName: '1.0.1',
        apkUrl: 'https://127.0.0.1:3417/downloads/android/rodzina-2-1.0.1.apk',
        sha256: 'ab'.repeat(32),
      }),
    }),
  );
  // The HTTP development origin must never accept metadata pointing to another origin.
  await page.reload();
  await expect(page.getByText('Wydanie Androida jest obecnie niedostępne.')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('android-download-login.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('/register');
  await page.getByLabel('Nazwa rodziny', { exact: true }).fill('Aktualizacje');
  await page.getByLabel('Twoje imię', { exact: true }).fill('Anna');
  await page.getByLabel('E-mail', { exact: true }).fill(`updates-${testInfo.project.name}@example.com`);
  await page.getByLabel('Hasło', { exact: true }).fill('password123');
  await page.getByRole('button', { name: 'Utwórz rodzinę' }).click();
  await expect(page.locator('.mantine-AppShell-main')).toBeVisible();
  await page.goto('/wiecej');
  await expect(page.getByText('Wydanie Androida jest obecnie niedostępne.')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('android-download-more.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('browser displays a published same-domain HTTPS release and instructions', async ({ page }, testInfo) => {
  let authenticated = false;
  const user = {
    id: 'user',
    familyId: 'family',
    displayName: 'Anna',
    email: 'anna@example.com',
    role: 'admin',
    color: '#228be6',
    createdAt: 0,
    updatedAt: 0,
  };
  // A local HTTPS document is served by Playwright routing; no external server is contacted.
  await page.route('https://rodzina.preficze.pl/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me' && authenticated)
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          user,
          family: { id: 'family', name: 'Rodzina', timezone: 'Europe/Warsaw', joinCode: 'ABC123' },
        }),
      });
    // Session confirmation and background prefetches must share the mocked authenticated state.
    // Forwarding them to the real API would return 401 and sign the browser out.
    const authenticatedResponses: Record<string, unknown> = {
      '/api/members': { members: [user] },
      '/api/occurrences': { occurrences: [] },
      '/api/events/upcoming-distant': { events: [] },
      '/api/tasks/lists': { lists: [] },
    };
    if (authenticated && Object.hasOwn(authenticatedResponses, url.pathname))
      return route.fulfill({ json: authenticatedResponses[url.pathname] });
    if (url.pathname === '/downloads/android/latest.json')
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          versionCode: 2,
          versionName: '1.0.1',
          apkUrl: 'https://rodzina.preficze.pl/downloads/android/rodzina-2-1.0.1.apk',
          sha256: 'ab'.repeat(32),
        }),
      });
    const response = await page.request.get(`http://127.0.0.1:3417${url.pathname}${url.search}`);
    return route.fulfill({ response });
  });
  await page.goto('https://rodzina.preficze.pl/login');
  await expect(page.getByRole('link', { name: 'Pobierz aplikację na Androida' })).toHaveAttribute(
    'href',
    'https://rodzina.preficze.pl/downloads/android/rodzina-2-1.0.1.apk',
  );
  await expect(page.getByText('Wersja Androida: 1.0.1')).toBeVisible();
  await expect(page.getByText(/Otwórz pobrany plik APK/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('android-download-published.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  authenticated = true;
  await page.goto('https://rodzina.preficze.pl/wiecej');
  await expect(page.getByRole('link', { name: 'Pobierz aplikację na Androida' })).toBeVisible();
  await expect(page.getByText('Wersja Androida: 1.0.1')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('android-more-published.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto('https://rodzina.preficze.pl/wiecej/powiadomienia');
  await expect(page.getByText('Przypomnienia są dostępne w aplikacji na Androida.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pobierz aplikację na Androida' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('android-reminders-published.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
