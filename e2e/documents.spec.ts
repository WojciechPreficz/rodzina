import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';
import { openNavigation } from './navigation.js';

for (const native of [false, true]) {
  test(`documents CRUD and layout via ${native ? 'Android transport' : 'website'}`, async ({ page, baseURL }, info) => {
    const headers = { Origin: baseURL! };
    const response = await page.request.post('/api/auth/register-family', {
      headers,
      data: {
        familyName: 'Dokumenty',
        displayName: 'Anna',
        email: `documents-${native}-${info.project.name}@example.com`,
        password: 'password123',
      },
    });
    expect(response.ok()).toBe(true);
    const session = await response.json();
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const fixtures = [
      { type: 'passport', label: 'Paszport Anny', expiresOn: '2030-05-12', holderUserId: session.user.id },
      { type: 'car_insurance', label: 'OC Skoda', expiresOn: '2020-11-15', vehicleLabel: 'Skoda Octavia' },
      { type: 'other', label: 'Bliski termin', expiresOn: tomorrow.toISOString().slice(0, 10) },
    ];
    for (const data of fixtures) expect((await page.request.post('/api/documents', { headers, data })).ok()).toBe(true);
    if (native) await installNativeTransport(page);
    await page.goto('/dokumenty');
    await expect(page.getByRole('heading', { name: 'Dokumenty', exact: true })).toBeVisible();
    await expect(page.getByText('Paszport Anny', { exact: true })).toBeVisible();
    await expect(page.getByText('Wygasł', { exact: true })).toBeVisible();
    await expect(page.locator('.document-row[data-status="valid"] .document-status-dot')).toHaveCSS(
      'background-color',
      'rgb(54, 118, 70)',
    );
    await expect(page.locator('.document-row[data-status="expiring"] .document-status-dot')).toHaveCSS(
      'background-color',
      'rgb(173, 101, 0)',
    );
    await expect(page.locator('.document-row[data-status="expired"] .document-status-dot')).toHaveCSS(
      'background-color',
      'rgb(195, 50, 39)',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`documents-${native}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Pojazdy', exact: true }).click();
    await expect(page.getByText('Paszport Anny', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Wszyscy', exact: true }).click();
    await page.getByRole('button', { name: '＋ Dodaj dokument', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Typ dokumentu', exact: true }).click();
    await page.getByRole('option', { name: 'Ubezpieczenie mieszkania', exact: true }).click();
    await expect(dialog.getByRole('textbox', { name: 'Posiadacz', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('textbox', { name: 'Pojazd', exact: true })).toHaveCount(0);
    await dialog.getByRole('textbox', { name: 'Nazwa dokumentu', exact: false }).fill('Polisa mieszkania');
    await dialog.getByLabel('Data ważności', { exact: false }).fill('2031-06-20');
    await page.screenshot({ path: info.outputPath(`document-form-${native}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await dialog.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Polisa mieszkania', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Edytuj Polisa mieszkania', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Nazwa dokumentu', exact: false }).fill('Polisa domu');
    await dialog.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'Usuń Polisa domu', exact: true }).click();
    await dialog.getByRole('button', { name: 'Usuń dokument', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Polisa domu', { exact: true })).toHaveCount(0);
    const navigation = await openNavigation(page);
    await expect(navigation.getByRole('link', { name: 'Dokumenty', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
}
