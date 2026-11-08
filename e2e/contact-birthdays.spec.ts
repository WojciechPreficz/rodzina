import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';

for (const native of [false, true]) {
  test(`contact birthdays via ${native ? 'Android transport' : 'website'}`, async ({ page, baseURL }, info) => {
    const headers = { Origin: baseURL! };
    const registration = await page.request.post('/api/test/families', {
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
    await page.getByLabel('Opis relacji').fill('Ciocia');
    await page.getByLabel('Telefon').fill('600 111 222');
    await page.getByLabel('Adres', { exact: true }).fill('ul. Łąkowa 3');
    await page.getByLabel('Dzień i miesiąc urodzin').fill('29.02');
    await page.getByLabel('Rok urodzenia (opcjonalnie)').fill('2000');
    await expect(page.getByText(/Przypomnienie dla wszystkich domowników/)).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('birthday-form.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(page.locator('.contact-row').getByText(/29\.02\.2000 · \d+\. urodziny w tym roku/)).toBeVisible();
    const fonts = await page.locator('.contact-row-content').evaluate((element) =>
      [...element.querySelectorAll('p, a')].map((node) => {
        const style = getComputedStyle(node);
        return [style.fontFamily, style.fontSize, style.fontWeight];
      }),
    );
    expect(fonts).toHaveLength(4);
    expect(fonts.every((font) => JSON.stringify(font) === JSON.stringify(fonts[0]))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('birthday-list.png'), fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Szczegóły kontaktu: Zofia' }).click();
    await expect(page.getByRole('dialog').getByText(/29\.02\.2000 · \d+\. urodziny w tym roku/)).toBeVisible();
    await page.getByRole('button', { name: 'Edytuj', exact: true }).click();
    await expect(page.getByLabel('Dzień i miesiąc urodzin')).toHaveValue('29.02');
    await page.getByLabel('Dzień i miesiąc urodzin').fill('20.10');
    await page.getByLabel('Rok urodzenia (opcjonalnie)').fill('1990');
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(page.getByRole('dialog').getByText(/20\.10\.1990 · \d+\. urodziny w tym roku/)).toBeVisible();
    await expect(page.locator('.contact-row').getByText(/20\.10\.1990 · \d+\. urodziny w tym roku/)).toHaveCount(1);
    await page.getByRole('button', { name: 'Edytuj', exact: true }).click();
    await page.getByLabel('Rok urodzenia (opcjonalnie)').fill('');
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(page.locator('.contact-row').getByText(/20\.10$/)).toBeVisible();
    await page.getByRole('button', { name: 'Edytuj', exact: true }).click();
    await expect(page.getByLabel('Rok urodzenia (opcjonalnie)')).toHaveValue('');
    await page.getByLabel('Dzień i miesiąc urodzin').fill('');
    await page.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Szczegóły kontaktu', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Urodziny' })).toHaveCount(0);
  });
}
