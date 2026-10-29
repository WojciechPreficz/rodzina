import { fork } from 'node:child_process';
import path from 'node:path';
import { test, expect } from '@playwright/test';

test('recovers the only admin through the test inbox and revokes sessions', async ({ page, browser }, testInfo) => {
  test.setTimeout(60000);
  const inbox: Array<{ to: string; link: string }> = [];
  const child = fork(path.resolve('e2e/fixtures/password-recovery-server.ts'), [], {
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let diagnostics = '';
  child.stderr?.on('data', (chunk) => {
    diagnostics += String(chunk);
  });
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Recovery server did not start: ${diagnostics}`)), 20000);
    child.on('message', (message: { type: string; url?: string; mail?: { to: string; link: string } }) => {
      if (message.type === 'ready') {
        clearTimeout(timer);
        resolve(message.url!);
      }
      if (message.type === 'mail') inbox.push(message.mail!);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Recovery server exited ${code}: ${diagnostics}`));
    });
  });
  const second = await browser.newContext({
    viewport: testInfo.project.use.viewport ?? { width: 1280, height: 800 },
    serviceWorkers: 'block',
  });
  try {
    const email = 'admin@example.com';
    await page.goto(`${url}/register`);
    await page.getByLabel('Nazwa rodziny', { exact: true }).fill('Rodzina testowa');
    await page.getByLabel('Twoje imię', { exact: true }).fill('Admin');
    await page.getByLabel('E-mail', { exact: true }).fill(email);
    await page.getByLabel('Hasło', { exact: true }).fill('password123');
    await page.getByRole('button', { name: 'Utwórz rodzinę' }).click();
    await expect(page.locator('.mantine-AppShell-main')).toBeVisible();
    const other = await second.newPage();
    await other.goto(`${url}/login`);
    await other.getByLabel('E-mail', { exact: true }).fill(email);
    await other.getByLabel('Hasło', { exact: true }).fill('password123');
    await other.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
    await expect(other.locator('.mantine-AppShell-main')).toBeVisible();
    // Keep one active session on the reset screen to exercise local cleanup too.
    await page.goto(`${url}/nie-pamietam-hasla`);
    await expect(page.getByRole('button', { name: 'Wyślij link do zmiany hasła' })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('forgot-password.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByLabel('E-mail').fill(email);
    await page.getByRole('button', { name: 'Wyślij link do zmiany hasła' }).click();
    await expect(page.getByRole('status')).toContainText('Jeśli istnieje konto', { timeout: 15000 });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.to).toBe(email);
    const resetPath = new URL(inbox[0]!.link).pathname;
    const documentResponse = await page.goto(`${url}${resetPath}`);
    expect(documentResponse?.headers()['cache-control']).toBe('no-store');
    expect(documentResponse?.headers()['referrer-policy']).toBe('no-referrer');
    await page.screenshot({ path: testInfo.outputPath('reset-password.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByLabel(/^Nowe hasło/).fill('newPassword123');
    await page.getByLabel(/^Powtórz hasło/).fill('newPassword123');
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Hasło zostało zmienione');
    expect((await other.request.get(`${url}/api/auth/me`)).status()).toBe(401);
    expect((await page.request.get(`${url}/api/auth/me`)).status()).toBe(401);
    await page.getByRole('link', { name: 'Zaloguj się' }).click();
    await page.getByLabel('E-mail', { exact: true }).fill(email);
    await page.getByLabel('Hasło', { exact: true }).fill('password123');
    await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Nieprawidłowy');
    await page.getByLabel('Hasło', { exact: true }).fill('newPassword123');
    await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
    await expect(page.locator('.mantine-AppShell-main')).toBeVisible();
    await page.goto(`${url}${resetPath}`);
    await page.getByLabel(/^Nowe hasło/).fill('anotherPassword123');
    await page.getByLabel(/^Powtórz hasło/).fill('anotherPassword123');
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('wykorzystany');
    await expect(page.getByRole('link', { name: 'Nie pamiętam hasła' })).toBeVisible();
  } finally {
    await second.close();
    child.kill();
  }
});
