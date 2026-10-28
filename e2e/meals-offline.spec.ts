import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';
import { readOfflineSnapshot } from './offlineDatabase.js';

for (const native of [false, true]) {
  test(`meal edits, frozen exports and purchases survive offline restart via ${native ? 'Android transport' : 'WWW'}`, async ({
    page,
    browser,
    baseURL,
  }, info) => {
    test.setTimeout(90000);
    const headers = { Origin: baseURL! };
    const registration = await page.request.post('/api/auth/register-family', {
      headers,
      data: {
        familyName: 'Obiady offline',
        displayName: 'Ania',
        email: `meals-offline-${native}-${info.project.name}-${info.repeatEachIndex}@example.com`,
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
    const weekStart = monday.toISOString().slice(0, 10);
    expect(
      (
        await page.request.put(`/api/meals/${today}/dinner`, {
          headers,
          data: {
            title: 'Zupa testowa',
            ingredients: [{ name: 'Pomidory', quantity: '1 kg' }],
          },
        })
      ).ok(),
    ).toBe(true);
    const lists = await (await page.request.get('/api/shopping/lists')).json();
    const listId = lists.lists[0].id as string;
    const listName = lists.lists[0].name as string;
    expect(
      (
        await page.request.post(`/api/shopping/lists/${listId}/items`, {
          headers,
          data: { name: 'Pomidory', quantity: '500 g' },
        })
      ).ok(),
    ).toBe(true);
    let offline = false;
    let dropResponse = true;
    const exportRequests: { url: string; body: string | null }[] = [];
    await page.route('**/api/**', async (route) => {
      if (offline) return route.abort('internetdisconnected');
      if (route.request().url().includes('/api/meals/to-shopping-list')) {
        exportRequests.push({ url: route.request().url(), body: route.request().postData() });
        if (dropResponse) {
          dropResponse = false;
          const response = await route.fetch();
          expect(response.ok()).toBe(true);
          return route.abort('connectionfailed');
        }
      }
      return route.continue();
    });
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => localStorage.getItem('test:offline') !== 'yes',
      }),
    );
    if (native) await installNativeTransport(page);
    await page.goto(`/zakupy?lista=${listId}`);
    await expect(page.getByText('500 g', { exact: true })).toBeVisible();
    // Rendering precedes asynchronous persistence. A full navigation can stop
    // that write, leaving the export without its required offline shopping data.
    await expect
      .poll(
        async () => {
          const saved = await readOfflineSnapshot<{
            queries: { queryKey: unknown[]; state: { data: { id?: string; quantity?: string }[] } }[];
          }>(page, 'shopping');
          return {
            list: saved?.queries.some(
              (query) => query.queryKey[3] === 'lists' && query.state.data.some((list) => list.id === listId),
            ),
            items: saved?.queries.some(
              (query) =>
                query.queryKey[3] === 'items' &&
                query.queryKey[4] === listId &&
                query.state.data.some((item) => item.quantity === '500 g'),
            ),
          };
        },
        { message: 'Shopping list and items must be persisted before leaving the page' },
      )
      .toEqual({ list: true, items: true });
    await page.goto('/obiady');
    await expect(page.getByRole('heading', { name: 'Zupa testowa', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Następny tydzień' }).click();
    await expect(page.getByRole('article')).toHaveCount(7);
    await page.getByRole('button', { name: 'Dziś', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Zupa testowa', exact: true })).toBeVisible();
    offline = true;
    await page.evaluate(() => {
      localStorage.setItem('test:offline', 'yes');
      window.dispatchEvent(new Event('offline'));
    });
    const soup = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name: 'Zupa testowa', exact: true }) });
    await soup.getByRole('button', { name: /Edytuj obiad:/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Ilość 1', exact: true }).fill('2 kg');
    await dialog.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page
      .getByRole('button', { name: /Dodaj obiad:/ })
      .first()
      .click();
    await dialog.getByRole('textbox', { name: 'Nazwa dania' }).fill('Makaron offline');
    await dialog.getByRole('button', { name: 'Dodaj składnik', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Składnik 1', exact: true }).fill(' pomidory ');
    await dialog.getByRole('textbox', { name: 'Ilość 1', exact: true }).fill('1 kg');
    await dialog.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'Następny tydzień' }).click();
    await page.getByRole('button', { name: 'Skopiuj poprzedni tydzień', exact: true }).click();
    await dialog.getByRole('button', { name: 'Kopiuj', exact: true }).click();
    await expect(page.getByText('Skopiowano obiadów: 2.')).toBeVisible();
    await page.getByRole('button', { name: 'Następny tydzień' }).click();
    await expect(page.getByText(/Ten tydzień nie został pobrany/)).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Skopiuj poprzedni tydzień', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Dziś', exact: true }).click();
    await page.getByRole('button', { name: 'Dodaj składniki do listy zakupów', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Lista zakupów' }).click();
    await page.getByRole('option', { name: listName, exact: true }).click();
    await expect(dialog.getByRole('checkbox', { name: /Zupa testowa/ })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: /Makaron offline/ })).toBeChecked();
    await expect(dialog.getByRole('button', { name: 'Dodaj składniki', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: 'Dodaj składniki', exact: true }).click();
    await expect(dialog.getByText(/Eksport zapisany na urządzeniu/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Gotowe' }).click();
    await soup.getByRole('button', { name: /Edytuj obiad:/ }).click();
    await dialog.getByRole('textbox', { name: 'Ilość 1', exact: true }).fill('10 kg');
    await dialog.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Makaron offline', exact: true })).toBeVisible();
    await expect(page.getByText('Pomidory — 10 kg', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('meals-offline-restarted.png'), fullPage: true });
    await page.goto(`/zakupy?lista=${listId}`);
    await expect(
      page.getByText('500 g + 1 kg + 2 kg', { exact: true }).or(page.getByText('500 g + 2 kg + 1 kg', { exact: true })),
    ).toBeVisible();
    offline = false;
    await page.evaluate(() => {
      localStorage.removeItem('test:offline');
      window.dispatchEvent(new Event('online'));
    });
    await expect
      .poll(
        async () => {
          const response = await page.request.get(`/api/meals?weekStart=${weekStart}`);
          const result = await response.json();
          return result.days
            .flatMap((day: { meals: { ingredients: { quantity: string }[] }[] }) => day.meals)
            .some((meal: { ingredients: { quantity: string }[] }) => meal.ingredients[0]?.quantity === '10 kg');
        },
        { timeout: 30000 },
      )
      .toBe(true);
    expect(exportRequests).toHaveLength(2);
    expect(exportRequests[0]).toEqual(exportRequests[1]);
    const items = (await (await page.request.get(`/api/shopping/lists/${listId}/items`)).json()).items as {
      quantity: string;
    }[];
    expect(items).toHaveLength(1);
    expect(['500 g + 1 kg + 2 kg', '500 g + 2 kg + 1 kg']).toContain(items[0]!.quantity);
    const otherContext = await browser.newContext({
      baseURL: baseURL!,
      storageState: { cookies: await page.context().cookies(), origins: [] },
      viewport: info.project.use.viewport!,
    });
    try {
      const other = await otherContext.newPage();
      await other.goto('/obiady');
      await expect(other.getByRole('heading', { name: 'Makaron offline', exact: true })).toBeVisible();
      await expect(other.getByText('Pomidory — 10 kg', { exact: true })).toBeVisible();
      await other.getByRole('button', { name: 'Następny tydzień' }).click();
      await expect(other.getByText('Pomidory — 2 kg', { exact: true })).toBeVisible();
    } finally {
      await otherContext.close();
    }
  });
}
