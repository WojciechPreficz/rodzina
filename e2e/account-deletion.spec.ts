import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';

for (const native of [false, true]) {
  test(`deletes child, own account and family through ${native ? 'Android transport' : 'website'}`, async ({
    page,
    browser,
    baseURL,
  }, info) => {
    const headers = { Origin: baseURL! };
    const password = 'password123';
    const email = `deletion-${native}-${info.project.name}@example.com`;
    const register = await page.request.post('/api/auth/register-family', {
      headers,
      data: { familyName: 'Rodzina testowa', displayName: 'Anna', email, password },
    });
    expect(register.ok()).toBe(true);
    const created = await page.request.post('/api/members/child', {
      headers,
      data: { displayName: 'Zosia', pin: '1234' },
    });
    expect(created.ok()).toBe(true);
    const invite = await page.request.post('/api/invitations', { headers, data: { role: 'member' } });
    const adult = await browser.newContext({
      baseURL: baseURL!,
      viewport: info.project.use.viewport ?? { width: 1280, height: 800 },
      serviceWorkers: 'block',
    });
    try {
      const accepted = await adult.request.post(`/api/invitations/${(await invite.json()).token}/accept`, {
        headers,
        data: { displayName: 'Piotr', email: `member-${email}`, password },
      });
      expect(accepted.ok()).toBe(true);
      const adultPage = await adult.newPage();
      if (native) await installNativeTransport(adultPage);
      await adultPage.goto('/wiecej/rodzina');
      await expect(adultPage.getByRole('button', { name: 'Usuń konto: Zosia' })).toBeEnabled();
      await expect(adultPage.getByRole('button', { name: 'Usuń konto: Anna' })).toHaveCount(0);
      await expect(adultPage.getByRole('button', { name: 'Usuń całą rodzinę' })).toHaveCount(0);
      await adultPage.getByRole('button', { name: 'Usuń konto: Zosia' }).click();
      let dialog = adultPage.getByRole('dialog');
      await dialog.getByLabel('Twoje hasło').fill('wrong');
      await dialog.getByRole('button', { name: 'Usuń trwale' }).click();
      await expect(dialog.getByRole('alert')).toContainText('Nieprawidłowe hasło');
      await dialog.getByLabel('Twoje hasło').fill(password);
      await dialog.getByRole('button', { name: 'Usuń trwale' }).click();
      await expect(adultPage.getByText('Zosia', { exact: true })).toHaveCount(0);
      await adultPage.getByRole('button', { name: 'Usuń moje konto' }).click();
      dialog = adultPage.getByRole('dialog');
      await dialog.getByLabel('Twoje hasło').fill(password);
      await dialog.getByRole('button', { name: 'Usuń trwale' }).click();
      await expect(adultPage).toHaveURL(/\/login/);

      if (native) await installNativeTransport(page);
      await page.goto('/wiecej/rodzina');
      await expect(page.getByRole('button', { name: 'Usuń moje konto' })).toBeDisabled();
      await page.getByRole('button', { name: 'Usuń całą rodzinę' }).click();
      dialog = page.getByRole('dialog');
      await dialog.getByLabel('Twoje hasło').fill(password);
      await expect(dialog.getByRole('button', { name: 'Usuń trwale' })).toBeDisabled();
      await dialog.getByLabel('Wpisz nazwę rodziny').fill('Rodzina testowa');
      await expect(dialog.getByRole('button', { name: 'Usuń trwale' })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath('delete-family.png'), fullPage: true });
      await dialog.getByRole('button', { name: 'Anuluj' }).click();
      await page.getByRole('button', { name: 'Usuń całą rodzinę' }).click();
      await dialog.getByLabel('Twoje hasło').fill(password);
      await dialog.getByLabel('Wpisz nazwę rodziny').fill('Rodzina testowa');
      await dialog.getByRole('button', { name: 'Usuń trwale' }).click();
      await expect(page).toHaveURL(/\/login/);
      expect((await page.request.post('/api/auth/login', { headers, data: { email, password } })).status()).toBe(403);
    } finally {
      await adult.close();
    }
  });
}
