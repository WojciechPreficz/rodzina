import { expect, test, type Page } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';

async function setOffline(page: Page, offline: boolean) {
  await page.evaluate((offline) => {
    if (offline) localStorage.setItem('test:offline', 'yes');
    else localStorage.removeItem('test:offline');
    window.dispatchEvent(new Event(offline ? 'offline' : 'online'));
  }, offline);
}

function outboxCount(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('rodzina-offline');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const count = db.transaction('outbox').objectStore('outbox').count();
          count.onsuccess = () => resolve(count.result);
          count.onerror = () => reject(count.error);
          db.close();
        };
      }),
  );
}

for (const scenario of ['same account', 'different account', 'Android transport', 'discard', 'send'] as const) {
  test(`offline edits at the session boundary: ${scenario}`, async ({ page, browser, baseURL }, info) => {
    const headers = { Origin: baseURL! };
    const email = `offline-session-${scenario.replaceAll(' ', '-')}-${info.project.name}@example.com`.toLowerCase();
    const password = 'password123';
    const registration = { familyName: 'Dom', displayName: 'Anna', email, password };
    const otherEmail = `other-${email}`;
    if (scenario === 'different account') {
      const other = await browser.newContext({ baseURL: baseURL! });
      try {
        expect(
          (
            await other.request.post('/api/test/families', { headers, data: { ...registration, email: otherEmail } })
          ).ok(),
        ).toBe(true);
      } finally {
        await other.close();
      }
    }
    expect((await page.request.post('/api/test/families', { headers, data: registration })).ok()).toBe(true);
    const { lists } = await (await page.request.get('/api/tasks/lists')).json();
    const listId = lists[0].id;
    const title = 'Zadanie zapisane bez sieci';
    if (scenario === 'Android transport') await installNativeTransport(page);
    else
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'onLine', {
          get: () => localStorage.getItem('test:offline') !== 'yes',
        });
      });
    await page.goto(`/zadania/${listId}`);
    const input = page.getByRole('textbox', { name: 'Dodaj zadanie', exact: true });
    await expect(input).toBeEnabled();
    await setOffline(page, true);
    await input.fill(title);
    await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
    await expect(page.getByRole('article', { name: title })).toBeVisible();
    await expect.poll(() => outboxCount(page)).toBe(1);

    if (scenario === 'discard' || scenario === 'send') {
      if (info.project.name === 'phone') await page.getByRole('button', { name: 'Otwórz menu' }).click();
      await page.getByRole('button', { name: 'Wyloguj się' }).click();
      const dialog = page.getByRole('dialog', { name: 'Niewysłane zmiany' });
      await expect(dialog.getByText('Liczba niewysłanych zmian: 1')).toBeVisible();
      const send = dialog.getByRole('button', { name: 'Wyślij i wyloguj' });
      await expect(send).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (scenario === 'send') {
        let release!: () => void;
        const sending = new Promise<void>((resolve) => {
          release = resolve;
        });
        await page.route('**/api/tasks/lists/*/tasks?*', async (route) => {
          if (route.request().method() === 'POST') await sending;
          await route.continue();
        });
        const mutation = page.waitForRequest(
          (request) => request.method() === 'POST' && request.url().includes(`/api/tasks/lists/${listId}/tasks?`),
        );
        await setOffline(page, false);
        await expect(send).toBeVisible();
        await send.click();
        release();
        await mutation;
      } else {
        await dialog.getByRole('button', { name: 'Anuluj' }).click();
        await expect(dialog).toHaveCount(0);
        await expect.poll(() => outboxCount(page)).toBe(1);
        await page.getByRole('button', { name: 'Wyloguj się' }).click();
        await dialog.getByRole('button', { name: 'Wyloguj i odrzuć zmiany' }).click();
      }
      await expect(page).toHaveURL(/\/login/);
      await expect.poll(() => outboxCount(page)).toBe(0);
    } else {
      // Revoke the session on the server before reconnecting the frontend.
      expect((await page.request.post('/api/auth/logout', { headers })).ok()).toBe(true);
      await setOffline(page, false);
      await expect(page).toHaveURL(/\/login/);
      await expect.poll(() => outboxCount(page)).toBe(1);
      await page.reload();
      await page.getByLabel('E-mail', { exact: true }).fill(scenario === 'different account' ? otherEmail : email);
      await page.getByLabel('Hasło', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
      await expect(page).toHaveURL(/\/zadania/);
      await expect.poll(() => outboxCount(page)).toBe(0);
      if (scenario !== 'different account') await expect(page.getByRole('article', { name: title })).toBeVisible();
    }

    const verification = await browser.newContext({ baseURL: baseURL! });
    try {
      expect((await verification.request.post('/api/auth/login', { headers, data: { email, password } })).ok()).toBe(
        true,
      );
      const { tasks } = await (await verification.request.get(`/api/tasks/lists/${listId}/tasks`)).json();
      expect(tasks.filter((task: { title: string }) => task.title === title)).toHaveLength(
        scenario === 'discard' || scenario === 'different account' ? 0 : 1,
      );
    } finally {
      await verification.close();
    }
  });
}
