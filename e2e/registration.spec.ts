import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';

for (const native of [false, true]) {
  test(`confirms a new family through email using ${native ? 'Android transport' : 'WWW'}`, async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    const email = `confirm-${native}-${testInfo.project.name}@example.com`;
    if (native) await installNativeTransport(page);
    await page.goto('/register');
    await page.getByLabel('Nazwa rodziny', { exact: true }).fill('Rodzina potwierdzona');
    await page.getByLabel('Twoje imię', { exact: true }).fill('Anna');
    await page.getByLabel('E-mail', { exact: true }).fill(email);
    await page.getByLabel('Hasło', { exact: true }).fill('password123');
    await page.getByRole('button', { name: 'Utwórz rodzinę' }).click();
    await expect(page.getByRole('status')).toContainText('Konto rodziny jeszcze nie istnieje');
    await page.screenshot({ path: testInfo.outputPath(`registration-sent-${native}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const login = () =>
      page.request.post('/api/auth/login', { headers: { Origin: baseURL! }, data: { email, password: 'password123' } });
    expect((await login()).status()).toBe(403);
    const mail = await (
      await page.request.get(`/api/test/registration-mail?email=${encodeURIComponent(email)}`)
    ).json();
    const link = new URL(mail.link);
    // Email opens in a separate browser context, also for registration started in APK.
    const context = await browser.newContext({
      baseURL: baseURL!,
      viewport: testInfo.project.use.viewport ?? { width: 1280, height: 800 },
      serviceWorkers: 'block',
    });
    try {
      const confirmation = await context.newPage();
      const response = await confirmation.goto(link.pathname + link.hash);
      expect(response?.headers()['cache-control']).toBe('no-store');
      expect(response?.headers()['referrer-policy']).toBe('no-referrer');
      expect((await login()).status()).toBe(403);
      await confirmation.screenshot({
        path: testInfo.outputPath(`registration-confirm-${native}.png`),
        fullPage: true,
      });
      expect(await confirmation.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await confirmation.getByRole('button', { name: 'Potwierdź i utwórz rodzinę' }).focus();
      await confirmation.keyboard.press('Enter');
      await expect(confirmation.getByRole('status')).toContainText('zostały utworzone');
      expect(new URL(confirmation.url()).hash).toBe('');
      expect((await confirmation.request.get('/api/auth/me')).status()).toBe(401);
      await confirmation.goto(link.pathname + link.hash);
      await confirmation.getByRole('button', { name: 'Potwierdź i utwórz rodzinę' }).click();
      await expect(confirmation.getByRole('alert')).toContainText('został już wykorzystany');
      await confirmation.screenshot({ path: testInfo.outputPath(`registration-used-${native}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Przejdź do logowania' }).click();
      await page.getByLabel('E-mail', { exact: true }).fill(email);
      await page.getByLabel('Hasło', { exact: true }).fill('password123');
      await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
      await expect(page.locator('.mantine-AppShell-main')).toBeVisible();
    } finally {
      await context.close();
    }
  });
}

test('shows malformed links without attempting account creation', async ({ page }, testInfo) => {
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') mutations.push(request.url());
  });
  await page.goto('/potwierdz-rodzine#token=bad');
  await expect(page.getByRole('alert')).toContainText('nieprawidłowy');
  expect(mutations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('registration-invalid.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Ponów rejestrację' }).click();
  await expect(page.getByLabel('Nazwa rodziny', { exact: true })).toBeVisible();
});
