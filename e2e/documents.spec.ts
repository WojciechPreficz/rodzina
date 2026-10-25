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
    const mobile = info.project.name === 'phone';
    const relatives = ['Aleksandra', 'Bartłomiej', 'Katarzyna', 'Małgorzata', 'Stanisław', 'Zuzanna'];
    for (const displayName of relatives) {
      expect(
        (
          await page.request.post('/api/members/child', {
            headers,
            data: { displayName, pin: '1234', color: '#1C7ED6' },
          })
        ).ok(),
      ).toBe(true);
    }
    const pickFilter = async (label: string) => {
      if (mobile) {
        const input = page.getByRole('textbox', { name: 'Filtr dokumentów', exact: true });
        await input.fill(label);
        await page.getByRole('option', { name: label, exact: true }).click();
        await input.press('Escape');
      } else {
        await page.getByRole('button', { name: label, exact: true }).click();
      }
    };
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const fixtures = [
      { type: 'passport', label: 'Paszport Anny', expiresOn: '2030-05-12', holderUserId: session.user.id },
      { type: 'car_insurance', label: 'OC Skoda', expiresOn: '2020-11-15', vehicleLabel: 'Skoda Octavia' },
      { type: 'other', label: 'Bliski termin', expiresOn: tomorrow.toISOString().slice(0, 10) },
      { type: 'rental_agreement', label: 'Najem mieszkania', expiresOn: '2031-05-12' },
    ];
    for (const data of fixtures) expect((await page.request.post('/api/documents', { headers, data })).ok()).toBe(true);
    if (native) await installNativeTransport(page);
    await page.goto('/dokumenty');
    await expect(page.getByRole('heading', { name: 'Dokumenty', exact: true })).toBeVisible();
    await expect(page.getByText('Paszport Anny', { exact: true })).toBeVisible();
    await expect(page.getByText('Wygasł', { exact: true })).toBeVisible();
    await expect(page.locator('.document-row[data-status="valid"] .document-status-dot').first()).toHaveCSS(
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
    if (mobile) {
      await expect(page.getByRole('navigation', { name: 'Filtr dokumentów' })).toHaveCount(0);
      await pickFilter('Mieszkanie');
      await pickFilter('Pojazdy');
      const filterInput = page.locator('.documents-mobile-filter .mantine-MultiSelect-input');
      const inputBox = (await filterInput.boundingBox())!;
      expect(inputBox.height).toBeLessThanOrEqual(48);
      for (const pill of await page.locator('.documents-mobile-filter .mantine-Pill-root').all()) {
        const pillBox = (await pill.boundingBox())!;
        expect(Math.abs(pillBox.y + pillBox.height / 2 - (inputBox.y + inputBox.height / 2))).toBeLessThanOrEqual(2);
      }
      await page.screenshot({ path: info.outputPath(`documents-two-filters-${native}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Wyczyść filtry' }).click();
      for (const name of relatives) await pickFilter(name);
      for (const label of await page.locator('.documents-mobile-filter .mantine-Pill-label').all()) {
        await expect(label).toHaveCSS('white-space', 'nowrap');
        expect((await label.boundingBox())!.height).toBeLessThanOrEqual(28);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`documents-large-family-${native}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Wyczyść filtry' }).click();
    }
    await pickFilter('Wygasa');
    await expect(page.locator('.document-row')).toHaveCount(1);
    await expect(page.getByText('Bliski termin', { exact: true })).toBeVisible();
    await pickFilter('Wygasło');
    await expect(page.locator('.document-row')).toHaveCount(mobile ? 2 : 1);
    await pickFilter('Pojazdy');
    await expect(page.locator('.document-row')).toHaveCount(1);
    await expect(page.getByText('OC Skoda', { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`documents-status-filter-${native}.png`), fullPage: true });
    if (mobile) await page.getByRole('button', { name: 'Wyczyść filtry' }).click();
    else {
      await page.getByRole('button', { name: 'Wygasło', exact: true }).click();
      await pickFilter('Wszyscy');
    }
    await pickFilter('Pojazdy');
    await expect(page.getByText('Paszport Anny', { exact: true })).toHaveCount(0);
    if (mobile) await page.getByRole('button', { name: 'Wyczyść filtry' }).click();
    else await pickFilter('Wszyscy');
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
    await pickFilter('Mieszkanie');
    await expect(page.getByRole('heading', { name: 'Mieszkanie', exact: true })).toBeVisible();
    await expect(page.locator('.document-row')).toHaveCount(2);
    await expect(page.getByText('Polisa mieszkania', { exact: true })).toBeVisible();
    await expect(page.getByText('Najem mieszkania', { exact: true })).toBeVisible();
    await expect(page.getByText('OC Skoda', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Paszport Anny', { exact: true })).toHaveCount(0);
    if (mobile) {
      await pickFilter('Anna');
      await expect(page.locator('.document-row')).toHaveCount(3);
      await expect(page.getByText('Paszport Anny', { exact: true })).toBeVisible();
      await expect(page.locator('.documents-mobile-filter .mantine-Pill-label').first()).toHaveCSS(
        'white-space',
        'nowrap',
      );
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`documents-home-${native}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Edytuj Polisa mieszkania', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Nazwa dokumentu', exact: false }).fill('Polisa domu');
    await dialog.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'Usuń Polisa domu', exact: true }).click();
    await dialog.getByRole('button', { name: 'Usuń dokument', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Polisa domu', { exact: true })).toHaveCount(0);
    const navigation = await openNavigation(page);
    await expect(navigation.getByRole('link', { name: /^Dokumenty/ })).toHaveAttribute('aria-current', 'page');
  });

  test(`document renewal, personal reminders and direct route via ${native ? 'Android transport' : 'website'}`, async ({
    page,
    baseURL,
  }, info) => {
    const headers = { Origin: baseURL! };
    expect(
      (
        await page.request.post('/api/auth/register-family', {
          headers,
          data: {
            familyName: 'Odnowienie',
            displayName: 'Anna',
            email: `renew-${native}-${info.project.name}@example.com`,
            password: 'password123',
          },
        })
      ).ok(),
    ).toBe(true);
    const response = await page.request.post('/api/documents', {
      headers,
      data: {
        type: 'car_insurance',
        label: 'OC do odnowienia',
        vehicleLabel: 'Skoda',
        expiresOn: '2020-01-01',
      },
    });
    expect(response.ok()).toBe(true);
    const { document } = await response.json();
    if (native) await installNativeTransport(page);
    await page.goto(`/dokumenty/${document.id}`);
    await expect(page.getByRole('heading', { name: 'OC do odnowienia', exact: true })).toBeVisible();
    const nav = await openNavigation(page);
    await expect(nav.getByLabel('Dokumenty wymagające uwagi: 1')).toBeVisible();
    if (native || info.project.name === 'phone') await page.getByRole('button', { name: 'Zamknij menu' }).click();
    const personal = page.getByRole('region', { name: 'Moje przypomnienia' });
    await personal.getByRole('button', { name: 'Dodaj przypomnienie', exact: true }).click();
    await expect(personal.getByRole('button', { name: 'Usuń przypomnienie' })).toBeVisible();
    expect(
      (await (await page.request.get(`/api/reminders/mine?documentId=${document.id}`)).json()).reminders,
    ).toHaveLength(1);
    await page.getByRole('button', { name: 'Odnowiono', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nowa data ważności', { exact: false }).fill('2035-05-12');
    await page.screenshot({ path: info.outputPath(`document-renew-${native}.png`), fullPage: true });
    await dialog.getByRole('button', { name: 'Zapisz nową datę' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(/ważny do 12.05.2035/)).toBeVisible();
    await expect(page.getByText('Ważny', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`document-details-${native}.png`), fullPage: true });
    await personal.getByRole('button', { name: 'Usuń przypomnienie' }).click();
    await expect(personal.getByRole('button', { name: 'Usuń przypomnienie' })).toHaveCount(0);
    await openNavigation(page);
    await expect(page.getByLabel('Dokumenty wymagające uwagi: 1')).toHaveCount(0);
    await page.goto('/dokumenty/10000000-0000-4000-8000-000000000001');
    await expect(page.getByText(/Nie znaleziono dokumentu/)).toBeVisible();
  });
}
