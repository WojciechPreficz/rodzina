import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';

for (const native of [false, true]) {
  test(`task changes survive offline reload and sync without duplicates via ${native ? 'Android transport' : 'WWW'}`, async ({
    page,
    browser,
    baseURL,
  }, info) => {
    test.setTimeout(90000);
    const headers = { Origin: baseURL! };
    const registered = await page.request.post('/api/auth/register-family', {
      headers,
      data: {
        familyName: 'Offline',
        displayName: 'Ania',
        email: `task-offline-${native}-${info.project.name}@example.com`,
        password: 'password123',
      },
    });
    expect(registered.ok()).toBe(true);
    const { lists } = await (await page.request.get('/api/tasks/lists')).json();
    const listId = lists[0].id;
    for (const title of ['Pierwsze', 'Drugie', 'Trzecie', 'Do usunięcia']) {
      expect(
        (
          await page.request.post(`/api/tasks/lists/${listId}/tasks`, {
            headers,
            data: { title, dueDate: '2020-01-01' },
          })
        ).ok(),
      ).toBe(true);
    }
    const second = await browser.newContext({
      baseURL: baseURL!,
      storageState: { cookies: await page.context().cookies(), origins: [] },
      viewport: info.project.use.viewport!,
    });
    try {
      let offline = false;
      await page.route('**/api/**', (route) => (offline ? route.abort('internetdisconnected') : route.continue()));
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'onLine', {
          configurable: true,
          get: () => localStorage.getItem('test:offline') !== 'yes',
        });
      });
      if (native) await installNativeTransport(page);
      await page.goto(`/zadania/${listId}`);
      await expect(page.getByRole('article')).toHaveCount(4);
      offline = true;
      await page.evaluate(() => {
        localStorage.setItem('test:offline', 'yes');
        window.dispatchEvent(new Event('offline'));
      });
      await expect(page.getByRole('alert').filter({ hasText: 'Jesteś offline' })).toBeVisible();
      await expect(page.getByText(/Bez internetu nie można tworzyć list/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Dodaj listę', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Ustawienia listy' })).toBeDisabled();
      for (const title of ['Pierwsze', 'Drugie', 'Trzecie'])
        await page.getByRole('article', { name: title, exact: true }).getByRole('checkbox').click();
      await page.getByRole('textbox', { name: 'Dodaj zadanie', exact: true }).fill('Nowe offline');
      await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
      const added = page.getByRole('article', { name: 'Nowe offline', exact: true });
      await added.getByRole('link').click();
      const form = page.getByRole('dialog');
      await expect(form.getByRole('textbox', { name: 'Osoba przypisana' })).toBeDisabled();
      await expect(form.getByRole('button', { name: 'Dodaj przypomnienie' })).toBeDisabled();
      await form.getByLabel('Notatka').fill('Zapisana na urządzeniu');
      await form.getByLabel('Termin', { exact: true }).fill('2020-01-01');
      await page.screenshot({
        path: info.outputPath(`task-offline-form-${native}.png`),
        fullPage: true,
        animations: 'disabled',
      });
      await form.getByRole('button', { name: 'Zapisz', exact: true }).click();
      await expect(form).toHaveCount(0);
      await page.getByRole('article', { name: 'Do usunięcia', exact: true }).getByRole('link').click();
      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: 'Usuń zadanie', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      // Reload only JavaScript/frontend; intercepted API calls remain offline.
      // This models bundled APK frontend and does not claim a physical process test.
      await page.reload();
      await expect(page.getByRole('article', { name: 'Nowe offline', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Zrobione (3)' })).toBeVisible();
      await expect(page.getByRole('article', { name: 'Do usunięcia', exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`task-offline-list-${native}.png`), fullPage: true });
      offline = false;
      await page.evaluate(() => {
        localStorage.removeItem('test:offline');
        window.dispatchEvent(new Event('online'));
      });
      await expect(page.getByText(/Zmiany oczekujące na wysłanie:/)).toHaveCount(0, { timeout: 25000 });
      const other = await second.newPage();
      await other.goto(`/zadania/${listId}`);
      await expect(other.getByRole('article', { name: 'Nowe offline', exact: true })).toBeVisible();
      const { tasks } = await (await second.request.get(`/api/tasks/lists/${listId}/tasks?status=all`)).json();
      expect(tasks).toHaveLength(4);
      expect(tasks.filter((task: { isDone: boolean }) => task.isDone)).toHaveLength(3);
      expect(tasks.filter((task: { title: string }) => task.title === 'Nowe offline')).toHaveLength(1);
      expect(tasks.find((task: { title: string }) => task.title === 'Nowe offline').notes).toBe(
        'Zapisana na urządzeniu',
      );
    } finally {
      await second.close();
    }
  });
}
