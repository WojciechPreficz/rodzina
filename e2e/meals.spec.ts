import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';

for (const native of [false, true]) {
  test(`plans five dinners, copies weeks, edits and deletes via ${native ? 'Android transport' : 'website'}`, async ({
    page,
    baseURL,
  }, info) => {
    const headers = { Origin: baseURL! };
    expect(
      (
        await page.request.post('/api/auth/register-family', {
          headers,
          data: {
            familyName: 'Obiady',
            displayName: 'Anna',
            email: `meals-${native}-${info.project.name}@example.com`,
            password: 'password123',
          },
        })
      ).ok(),
    ).toBe(true);
    if (native) await installNativeTransport(page);
    await page.goto('/obiady');
    await expect(page.getByRole('article')).toHaveCount(7);
    for (let day = 0; day < 5; day++) {
      await page
        .getByRole('article')
        .nth(day)
        .getByRole('button', { name: /Dodaj obiad/ })
        .press('Enter');
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('textbox', { name: 'Nazwa dania' }).fill(`Obiad ${day + 1}`);
      await dialog.getByRole('button', { name: 'Dodaj składnik' }).press('Enter');
      await expect(dialog.getByRole('textbox', { name: 'Składnik 1', exact: true })).toBeFocused();
      await dialog.getByRole('textbox', { name: 'Składnik 1', exact: true }).fill('Ziemniaki');
      await dialog.getByRole('textbox', { name: 'Ilość 1', exact: true }).fill('1 kg');
      await dialog.getByRole('button', { name: 'Zapisz', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('heading', { name: `Obiad ${day + 1}`, exact: true })).toBeVisible();
    }
    await page.screenshot({ path: info.outputPath('meals-week.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Następny tydzień' }).click();
    await expect(page.getByRole('button', { name: /Dodaj obiad:/ })).toHaveCount(7);
    await page.getByRole('button', { name: 'Skopiuj poprzedni tydzień', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Kopiuj', exact: true }).click();
    await expect(page.getByText('Skopiowano obiadów: 5.')).toBeVisible();
    await page
      .getByRole('article')
      .nth(5)
      .getByRole('button', { name: /Dodaj obiad/ })
      .click();
    const dialog = page.getByRole('dialog');
    const title = dialog.getByRole('textbox', { name: 'Nazwa dania' });
    await title.fill('Obiad 1');
    await page.getByRole('option', { name: 'Obiad 1', exact: true }).click();
    await expect(dialog.getByRole('textbox', { name: 'Składnik 1', exact: true })).toHaveValue('Ziemniaki');
    await page.screenshot({ path: info.outputPath('meals-form.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await dialog.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page
      .getByRole('article')
      .first()
      .getByRole('button', { name: /Edytuj obiad:/ })
      .click();
    await dialog.getByRole('textbox', { name: 'Nazwa dania' }).fill('Zmieniony obiad');
    await dialog.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'Skopiuj poprzedni tydzień', exact: true }).click();
    await dialog.getByRole('button', { name: 'Kopiuj', exact: true }).click();
    await expect(page.getByText('Skopiowano obiadów: 0.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Zmieniony obiad' })).toBeVisible();
    await page.getByRole('button', { name: 'Skopiuj poprzedni tydzień', exact: true }).click();
    await dialog.getByRole('checkbox', { name: 'Nadpisz istniejące obiady' }).check();
    await dialog.getByRole('button', { name: 'Kopiuj', exact: true }).click();
    await expect(page.getByText('Skopiowano obiadów: 5.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Zmieniony obiad' })).toHaveCount(0);
    await page
      .getByRole('article')
      .first()
      .getByRole('button', { name: /Usuń obiad:/ })
      .click();
    await dialog.getByRole('button', { name: 'Usuń', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page
        .getByRole('article')
        .first()
        .getByRole('button', { name: /Dodaj obiad/ }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Dziś', exact: true }).click();
    await expect(
      page.getByRole('article').first().getByRole('heading', { name: 'Obiad 1', exact: true }),
    ).toBeVisible();
  });
}
