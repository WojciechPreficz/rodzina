import { readOfflineSnapshot } from './offlineDatabase.js';
import type { OfflineData } from '../apps/web/src/offlineData.js';
import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';

for (const native of [false, true]) {
  test(`family offline ${native ? 'cold start through Android transport' : 'open website'} and code refresh`, async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    const headers = { Origin: baseURL! };
    const email = `family-offline-${native}-${testInfo.project.name}@example.com`;
    expect(
      (
        await page.request.post('/api/auth/register-family', {
          headers,
          data: {
            familyName: 'Rodzina offline',
            displayName: 'Ania',
            email,
            password: 'password123',
          },
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await page.request.post('/api/members/child', {
          headers,
          data: {
            displayName: 'Zosia',
            color: '#1C7ED6',
            pin: '1234',
          },
        })
      ).ok(),
    ).toBe(true);
    const original = (await (await page.request.get('/api/auth/me')).json()).family.joinCode as string;
    const other = await browser.newContext({ baseURL: baseURL!, serviceWorkers: 'block' });
    try {
      expect(
        (await other.request.post('/api/auth/login', { headers, data: { email, password: 'password123' } })).ok(),
      ).toBe(true);
      if (native) await installNativeTransport(page);
      // Family is prefetched without visiting its page.
      await page.goto('/zakupy');
      await expect
        .poll(() => readOfflineSnapshot<OfflineData>(page, 'family').then((saved) => saved?.members?.length))
        .toBe(2);
      await page.goto('/wiecej/rodzina');
      await expect(page.getByRole('button', { name: 'Dodaj dziecko' })).toBeEnabled();
      await page.getByRole('button', { name: 'Edytuj: Zosia' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByLabel('Nowy PIN')).toBeVisible();
      if (native) {
        await page.route('**/api/**', (route) => route.abort('internetdisconnected'));
        await page.evaluate(() => {
          localStorage.setItem('test:offline', 'yes');
          window.dispatchEvent(new Event('offline'));
        });
      } else {
        await page.context().setOffline(true);
      }
      await expect(dialog.getByRole('button', { name: 'Zapisz', exact: true })).toBeDisabled();
      await expect(dialog.getByRole('button', { name: 'Usuń domownika' })).toBeDisabled();
      await dialog.getByRole('button', { name: 'Anuluj' }).click();
      if (native) await page.reload();
      await expect(page.getByRole('status')).toContainText('Jesteś offline — pokazujemy ostatnio zapisane dane.');
      await expect(page.getByRole('status')).toContainText('Ostatnie udane pobranie');
      await expect(page.getByText('Zosia', { exact: true })).toBeVisible();
      await expect(page.getByText(original, { exact: true })).toBeVisible();
      for (const name of [
        'Dodaj dziecko',
        'Utwórz zaproszenie',
        'Wygeneruj nowy kod',
        'Edytuj: Ania',
        'Edytuj: Zosia',
      ]) {
        await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('family-offline.png'), fullPage: true });
      const rotation = await other.request.post('/api/family/join-code/rotate', { headers });
      expect(rotation.ok()).toBe(true);
      const { joinCode } = await rotation.json();
      expect(joinCode).not.toBe(original);
      if (native) {
        await page.unroute('**/api/**');
        await page.evaluate(() => {
          localStorage.removeItem('test:offline');
          window.dispatchEvent(new Event('online'));
        });
      } else {
        await page.context().setOffline(false);
      }
      await expect(page.getByRole('status')).toHaveCount(0);
      await expect(page.getByText(joinCode, { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Dodaj dziecko' })).toBeEnabled();
      await page.screenshot({ path: testInfo.outputPath('family-reconnected.png'), fullPage: true });
      await expect
        .poll(() => readOfflineSnapshot<OfflineData>(page, 'family').then((saved) => saved?.session.family.joinCode))
        .toBe(joinCode);
      const stored = JSON.stringify(await readOfflineSnapshot<OfflineData>(page, 'family'));
      expect(stored).toContain(joinCode);
      expect(stored).not.toContain(email);
    } finally {
      await page.context().setOffline(false);
      await other.close();
    }
  });
}
