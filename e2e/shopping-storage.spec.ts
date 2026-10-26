import { expect, test, type Page } from '@playwright/test';
import { readOfflineSnapshot } from './offlineDatabase.js';
async function open(page: Page) {
  await page.goto('/zakupy');
  if (page.viewportSize()!.width < 768) await page.getByRole('button', { name: 'Zakupy', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Dodaj produkt' })).toBeEnabled();
}
async function add(page: Page, name: string) {
  await page.getByRole('textbox', { name: 'Dodaj produkt' }).fill(name);
  await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
}
test.beforeEach(async ({ page, baseURL }, info) => {
  expect(
    (
      await page.request.post('/api/auth/register-family', {
        headers: { Origin: baseURL! },
        data: {
          familyName: 'Pamięć zakupów',
          displayName: 'Ania',
          email: `storage-${info.project.name}-${info.testId}@example.com`,
          password: 'password123',
        },
      })
    ).ok(),
  ).toBe(true);
});
test('two offline tabs preserve their intents and synchronize them once', async ({ page, context }, info) => {
  await open(page);
  const other = await context.newPage();
  try {
    await open(other);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await other.evaluate(() => window.dispatchEvent(new Event('offline')));
    await Promise.all([add(page, 'Ryż'), add(other, 'Kasza')]);
    await expect(page.getByRole('textbox', { name: 'Dodaj produkt' })).toBeEmpty();
    await expect(other.getByRole('textbox', { name: 'Dodaj produkt' })).toBeEmpty();
    await expect
      .poll(() =>
        readOfflineSnapshot<{ operations: unknown[] }>(page, 'shopping').then((data) => data?.operations.length),
      )
      .toBe(2);
    await expect(page.getByRole('article')).toHaveCount(2);
    await expect(other.getByRole('article')).toHaveCount(2);
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await other.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect
      .poll(() =>
        readOfflineSnapshot<{ operations: unknown[] }>(page, 'shopping').then((data) => data?.operations.length),
      )
      .toBe(0);
    const { lists } = await (await page.request.get('/api/shopping/lists')).json();
    const { items } = await (await page.request.get(`/api/shopping/lists/${lists[0].id}/items`)).json();
    expect(items.map((item: { name: string }) => item.name).sort()).toEqual(['Kasza', 'Ryż']);
    await page.screenshot({ path: info.outputPath('shopping-two-tabs.png'), fullPage: true });
  } finally {
    await other.close();
  }
});
test('quota denial leaves the form and confirmed data intact', async ({ page }, info) => {
  await open(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.name === 'cache') throw new DOMException('Full', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await add(page, 'Nie zapisano');
  await expect(page.getByRole('alert').filter({ hasText: 'Brak miejsca' }).first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Dodaj produkt' })).toHaveValue('Nie zapisano');
  await expect(page.getByRole('article', { name: 'Nie zapisano', exact: true })).toHaveCount(0);
  expect((await readOfflineSnapshot<{ operations: unknown[] }>(page, 'shopping'))?.operations).toHaveLength(0);
  expect(await page.evaluate(() => localStorage.getItem('rodzina:shopping:v1'))).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('shopping-quota.png'), fullPage: true });
});
