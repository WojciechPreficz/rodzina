import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';
import { openNavigation } from './navigation.js';
import { readOfflineSnapshot } from './offlineDatabase.js';

for (const native of [false, true]) {
  test(`task conflict preserves review and allows shopping and independent tasks via ${native ? 'Android transport' : 'WWW'}`, async ({
    page,
    baseURL,
  }, info) => {
    test.setTimeout(60000);
    const headers = { Origin: baseURL! };
    expect(
      (
        await page.request.post('/api/auth/register-family', {
          headers,
          data: {
            familyName: 'Wspólna kolejka',
            displayName: 'Ania',
            email: `shared-outbox-${native}-${info.project.name}@example.com`,
            password: 'password123',
          },
        })
      ).ok(),
    ).toBe(true);
    const { lists } = await (await page.request.get('/api/tasks/lists')).json();
    const taskListId = lists[0].id;
    const { task } = await (
      await page.request.post(`/api/tasks/lists/${taskListId}/tasks`, {
        headers,
        data: { title: 'Zadanie z konfliktem' },
      })
    ).json();
    const shoppingListId = (await (await page.request.get('/api/shopping/lists')).json()).lists[0].id;
    let offline = false;
    let blockedAttempts = 0;
    await page.route('**/api/**', async (route) => {
      if (offline) return route.abort('internetdisconnected');
      if (route.request().method() === 'PATCH' && new URL(route.request().url()).pathname === `/api/tasks/${task.id}`) {
        blockedAttempts++;
        return route.fulfill({
          status: 409,
          json: { error: { code: 'OPERATION_CONFLICT', message: 'Konflikt zadania.' } },
        });
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
    await page.goto('/zakupy');
    if (page.viewportSize()!.width < 768) await page.getByRole('button', { name: 'Zakupy', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Dodaj produkt' })).toBeVisible();
    await (await openNavigation(page)).getByRole('link', { name: 'Zadania', exact: true }).click();
    await page.getByRole('link', { name: 'Moje zadania', exact: true }).click();
    await expect(page.getByRole('article', { name: task.title })).toBeVisible();
    offline = true;
    await page.evaluate(() => {
      localStorage.setItem('test:offline', 'yes');
      window.dispatchEvent(new Event('offline'));
    });
    await page.getByRole('checkbox', { name: `Zrobione: ${task.title}` }).click();
    await page.getByRole('textbox', { name: 'Dodaj zadanie', exact: true }).fill('Niezależne zadanie');
    await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
    await (await openNavigation(page)).getByRole('link', { name: 'Zakupy', exact: true }).click();
    if (page.viewportSize()!.width < 768) await page.getByRole('button', { name: 'Zakupy', exact: true }).click();
    await page.getByRole('textbox', { name: 'Dodaj produkt' }).fill('Mleko 2l');
    await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Mleko', exact: true })).toBeVisible();
    expect((await readOfflineSnapshot<{ operations: unknown[] }>(page, 'tasks'))?.operations).toHaveLength(2);
    expect((await readOfflineSnapshot<{ operations: unknown[] }>(page, 'shopping'))?.operations).toHaveLength(1);
    await (await openNavigation(page)).getByRole('link', { name: 'Zadania', exact: true }).click();
    await page.getByRole('link', { name: 'Moje zadania', exact: true }).click();
    await page.reload();
    await expect(page.getByRole('article', { name: 'Niezależne zadanie' })).toBeVisible();
    offline = false;
    await page.evaluate(() => {
      localStorage.removeItem('test:offline');
      window.dispatchEvent(new Event('online'));
    });
    await expect
      .poll(
        async () => (await (await page.request.get(`/api/shopping/lists/${shoppingListId}/items`)).json()).items.length,
        { timeout: 25000 },
      )
      .toBe(1);
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/tasks/lists/${taskListId}/tasks?status=all`)).json()).tasks.length,
      )
      .toBe(2);
    await page.getByRole('button', { name: 'Sprawdź zmiany' }).click();
    const review = page.getByRole('dialog', { name: 'Zmiany wymagające sprawdzenia' });
    await expect(review.getByText('Zmiana jest sprzeczna ze stanem serwera i wymaga sprawdzenia.')).toBeVisible();
    expect(blockedAttempts).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({
      path: info.outputPath(`shared-outbox-review-${native}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  });
}
