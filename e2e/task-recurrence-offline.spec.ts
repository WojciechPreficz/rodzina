import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';

for (const native of [false, true]) {
  test(`recurring completion survives offline restart and reconciles via ${native ? 'Android transport' : 'WWW'}`, async ({
    page,
    baseURL,
  }, info) => {
    const headers = { Origin: baseURL! };
    expect(
      (
        await page.request.post('/api/auth/register-family', {
          headers,
          data: {
            familyName: 'Cykliczne offline',
            displayName: 'Ania',
            email: `recurrence-${native}-${info.project.name}@example.com`,
            password: 'password123',
          },
        })
      ).ok(),
    ).toBe(true);
    const { lists } = await (await page.request.get('/api/tasks/lists')).json();
    const listId = lists[0].id;
    const { task } = await (
      await page.request.post(`/api/tasks/lists/${listId}/tasks`, { headers, data: { title: 'Podlej kwiaty' } })
    ).json();
    const configured = await page.request.post(`/api/tasks/${task.id}/recurrence?operationId=${crypto.randomUUID()}`, {
      headers,
      data: {
        expectedVersion: 0,
        expectedOccurrenceVersion: 0,
        rule: {
          mode: 'after_completion',
          unit: 'day',
          interval: 2,
          startDate: '2026-01-01',
          time: null,
          timezone: 'Europe/Warsaw',
          endDate: null,
        },
        template: { title: 'Podlej kwiaty', notes: null, assigneeId: null, reminders: [] },
      },
    });
    expect(configured.ok()).toBe(true);
    const { series } = await configured.json();
    let offline = false;
    await page.route('**/api/**', (route) => (offline ? route.abort('internetdisconnected') : route.continue()));
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => localStorage.getItem('test:offline') !== 'yes',
      }),
    );
    if (native) await installNativeTransport(page);
    await page.goto(`/zadania/${listId}`);
    const article = page.getByRole('article', { name: 'Podlej kwiaty' });
    await expect(article.getByRole('checkbox')).toBeEnabled();
    offline = true;
    await page.evaluate(() => {
      localStorage.setItem('test:offline', 'yes');
      window.dispatchEvent(new Event('offline'));
    });
    const before = Date.now();
    await article.getByRole('checkbox').click();
    await expect(page.getByText('Kolejne zadanie po synchronizacji.', { exact: true })).toBeVisible();
    const after = Date.now();
    await page.screenshot({ path: info.outputPath(`recurring-pending-${native}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.reload();
    await expect(page.getByText('Kolejne zadanie po synchronizacji.', { exact: true })).toBeVisible();
    const beforeSync = await (await page.request.get(`/api/tasks/lists/${listId}/tasks?status=all`)).json();
    expect(beforeSync.tasks).toHaveLength(1);
    expect(beforeSync.tasks[0].isDone).toBe(false);
    offline = false;
    await page.evaluate(() => {
      localStorage.removeItem('test:offline');
      window.dispatchEvent(new Event('online'));
    });
    await expect(page.getByText('Kolejne zadanie po synchronizacji.', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Zmiany oczekujące na wysłanie:/)).toHaveCount(0);
    await expect(article.getByRole('checkbox')).not.toBeChecked();
    const saved = await (await page.request.get(`/api/tasks/lists/${listId}/tasks?status=all`)).json();
    expect(saved.tasks).toHaveLength(2);
    const closed = saved.tasks.find((entry: { id: string }) => entry.id === task.id);
    expect(closed.doneAt).toBeGreaterThanOrEqual(before);
    expect(closed.doneAt).toBeLessThanOrEqual(after);
    const { history } = await (await page.request.get(`/api/tasks/series/${series.id}/history`)).json();
    expect(history).toHaveLength(1);
    expect(history[0].closedAt).toBe(closed.doneAt);
  });
}
