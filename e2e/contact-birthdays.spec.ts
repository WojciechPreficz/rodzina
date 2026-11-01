import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';

for (const native of [false, true]) {
  test(`contact birthdays via ${native ? 'Android transport' : 'website'}`, async ({ page, baseURL }, info) => {
    const headers = { Origin: baseURL! };
    const registration = await page.request.post('/api/auth/register-family', {
      headers,
      data: {
        familyName: 'Urodziny',
        displayName: 'Anna',
        email: `birthdays-${info.project.name}-${native}@example.com`,
        password: 'password123',
      },
    });
    expect(registration.ok()).toBe(true);
    if (native) await installNativeTransport(page);
    await page.goto('/kontakty');
    await page.getByRole('button', { name: '＋ Dodaj kontakt' }).click();
    await page.getByLabel('Imię i nazwisko lub nazwa').fill('Zofia');
    await page.getByLabel('Data urodzin').fill('2000-02-29');
    await expect(page.getByText(/Przypomnienie dla wszystkich domowników/)).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('birthday-form.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(page.locator('.contact-row').getByText('Data urodzin: 29.02.2000')).toBeVisible();
    await page.screenshot({ path: info.outputPath('birthday-list.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Szczegóły kontaktu: Zofia' }).click();
    await expect(page.getByRole('dialog').getByText('Data urodzin: 29.02.2000')).toBeVisible();
    await page.getByRole('button', { name: 'Edytuj', exact: true }).click();
    await expect(page.getByLabel('Data urodzin')).toHaveValue('2000-02-29');
    await page.getByLabel('Data urodzin').fill('1990-10-20');
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(page.getByRole('dialog').getByText('Data urodzin: 20.10.1990')).toBeVisible();
    await expect(page.locator('.contact-row').getByText('Data urodzin: 20.10.1990')).toHaveCount(1);
    await page.getByRole('button', { name: 'Edytuj', exact: true }).click();
    await page.getByLabel('Data urodzin').fill('');
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Szczegóły kontaktu', exact: true })).toBeVisible();
    await expect(page.getByText(/Data urodzin:/)).toHaveCount(0);
  });
}
