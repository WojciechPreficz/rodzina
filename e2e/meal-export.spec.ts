import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';

for (const native of [false, true]) {
  test(`exports meals and shows today's dinner via ${native ? 'Android transport' : 'website'}`, async ({
    page,
    baseURL,
  }, info) => {
    const headers = { Origin: baseURL! };
    const registration = await page.request.post('/api/auth/register-family', {
      headers,
      data: {
        familyName: 'Eksport',
        displayName: 'Anna',
        email: `export-${native}-${info.project.name}@example.com`,
        password: 'password123',
      },
    });
    expect(registration.ok()).toBe(true);
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Warsaw',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const monday = new Date(`${today}T12:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const dates = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setUTCDate(date.getUTCDate() + index);
      return date.toISOString().slice(0, 10);
    });
    const planned = [today, ...dates.filter((date) => date !== today)].slice(0, 5);
    for (const [index, date] of planned.entries()) {
      expect(
        (
          await page.request.put(`/api/meals/${date}/dinner`, {
            headers,
            data: {
              title: index === 0 ? 'Dzisiejsza pomidorowa' : `Obiad ${index + 1}`,
              ingredients: [
                { name: index % 2 ? ' ziemniaki ' : 'Ziemniaki', quantity: '1 kg' },
                { name: 'Marchew', quantity: '2 szt.' },
              ],
            },
          })
        ).ok(),
      ).toBe(true);
    }
    const listResponse = await page.request.post('/api/shopping/lists', { headers, data: { name: 'Obiadowe zakupy' } });
    expect(listResponse.ok()).toBe(true);
    const { list } = (await listResponse.json()) as { list: { id: string } };
    const itemResponse = await page.request.post(`/api/shopping/lists/${list.id}/items`, {
      headers,
      data: { name: 'Ziemniaki', quantity: '500 g' },
    });
    expect(itemResponse.ok()).toBe(true);
    const checkedResponse = await page.request.post(`/api/shopping/lists/${list.id}/items`, {
      headers,
      data: { name: 'Marchew', quantity: '1 szt.' },
    });
    const { item: checked } = (await checkedResponse.json()) as { item: { id: string } };
    expect(
      (await page.request.patch(`/api/shopping/items/${checked.id}`, { headers, data: { isChecked: true } })).ok(),
    ).toBe(true);
    if (native) await installNativeTransport(page);
    await page.goto('/obiady');
    await page.getByRole('button', { name: 'Dodaj składniki do listy zakupów', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Lista zakupów' }).click();
    await page.getByRole('option', { name: 'Obiadowe zakupy' }).click();
    await expect(dialog.getByRole('checkbox', { checked: true })).toHaveCount(5);
    await page.screenshot({ path: info.outputPath('meal-export-selection.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await dialog.getByRole('button', { name: 'Dodaj składniki', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText('Dodano pozycji: 1. Uzupełniono pozycji: 1.');
    const readItems = async () =>
      (await (await page.request.get(`/api/shopping/lists/${list.id}/items`)).json()).items as {
        id: string;
        name: string;
        quantity: string;
        isChecked: boolean;
      }[];
    const items = await readItems();
    expect(items.find((item) => item.name === 'Ziemniaki')?.quantity).toBe('500 g + 1 kg + 1 kg + 1 kg + 1 kg + 1 kg');
    expect(items.find((item) => item.name === 'Marchew' && !item.isChecked)?.quantity).toBe(
      '2 szt. + 2 szt. + 2 szt. + 2 szt. + 2 szt.',
    );
    expect(items.find((item) => item.id === checked.id)).toMatchObject({ quantity: '1 szt.', isChecked: true });
    await dialog.getByRole('button', { name: 'Gotowe' }).click();
    await page.getByRole('button', { name: 'Dodaj składniki do listy zakupów', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Lista zakupów' }).click();
    await page.getByRole('option', { name: 'Obiadowe zakupy' }).click();
    await dialog.getByRole('button', { name: 'Dodaj składniki', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Dodaj ponownie' })).toBeDisabled();
    expect(await readItems()).toEqual(items);
    await page.screenshot({ path: info.outputPath('meal-export-repeat.png'), fullPage: true });
    await dialog.getByRole('button', { name: 'Anuluj' }).click();
    expect(
      (
        await page.request.put(`/api/meals/${today}/dinner`, {
          headers,
          data: { title: 'Zmieniony dzisiejszy obiad', ingredients: [{ name: 'Ryż', quantity: '100 g' }] },
        })
      ).ok(),
    ).toBe(true);
    expect(await readItems()).toEqual(items);
    await page.goto('/kalendarz');
    const card = page.getByRole('region', { name: 'Dziś na obiad' });
    await expect(card.getByText('Zmieniony dzisiejszy obiad')).toBeVisible();
    await page.screenshot({ path: info.outputPath('today-meal.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await card.getByRole('link', { name: 'Przejdź do planu obiadów' }).click();
    await expect(page).toHaveURL('/obiady');
  });
}
