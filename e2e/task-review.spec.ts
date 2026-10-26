import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';

for (const native of [false, true]) {
  test(`expired task review preserves confirmed data and independent sync via ${native ? 'Android transport' : 'website'}`, async ({
    page,
    baseURL,
  }, info) => {
    const headers = { Origin: baseURL! };
    const registration = await page.request.post('/api/auth/register-family', {
      headers,
      data: {
        familyName: 'Przegląd zmian',
        displayName: 'Ania',
        email: `review-${native}-${info.project.name}@example.com`,
        password: 'password123',
      },
    });
    expect(registration.ok()).toBe(true);
    const { lists } = await (await page.request.get('/api/tasks/lists')).json();
    const listId = lists[0].id as string;
    const response = await page.request.post(`/api/tasks/lists/${listId}/tasks`, {
      headers,
      data: { title: 'Potwierdzone zadanie' },
    });
    expect(response.ok()).toBe(true);
    const { task } = await response.json();
    if (native) await installNativeTransport(page);
    await page.goto(`/zadania/${listId}`);
    await expect(page.getByRole('article', { name: 'Potwierdzone zadanie' })).toBeVisible();
    await page.context().setOffline(true);
    await page.evaluate(() => {
      localStorage.setItem('test:offline', 'yes');
      window.dispatchEvent(new Event('offline'));
    });
    await expect(page.getByText('Jesteś offline', { exact: false })).toBeVisible();
    await page.evaluate(
      ({ listId, taskId }) => {
        const snapshot = JSON.parse(localStorage.getItem('rodzina:tasks:v1')!);
        const base = { listId, taskId };
        const ops = [
          {
            ...base,
            id: crypto.randomUUID(),
            submittedAt: Date.now() - 31 * 86400000,
            change: { type: 'update', data: { title: 'Stary lokalny tytuł', dueDate: '2027-01-01' } },
          },
          { ...base, id: crypto.randomUUID(), submittedAt: Date.now(), change: { type: 'remove' } },
        ];
        for (const op of ops) {
          const key = `rodzina:tasks:v1:operation:${snapshot.account}:${op.id}`;
          localStorage.setItem(key, JSON.stringify(op));
          window.dispatchEvent(new StorageEvent('storage', { key }));
        }
      },
      { listId, taskId: task.id as string },
    );
    await expect(page.getByRole('article', { name: 'Potwierdzone zadanie' })).toBeVisible();
    await expect(page.getByText('Zmiany do sprawdzenia: 2.', { exact: false })).toBeVisible();
    await page.getByRole('textbox', { name: 'Dodaj zadanie', exact: true }).fill('Świeża niezależna zmiana');
    await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Świeża niezależna zmiana' })).toBeVisible();
    await page.context().setOffline(false);
    await page.evaluate(() => {
      localStorage.removeItem('test:offline');
      window.dispatchEvent(new Event('online'));
    });
    await expect
      .poll(async () => {
        const result = await (await page.request.get(`/api/tasks/lists/${listId}/tasks?status=all`)).json();
        return result.tasks.map((entry: { title: string }) => entry.title).sort();
      })
      .toEqual(['Potwierdzone zadanie', 'Świeża niezależna zmiana'].sort());
    await expect(page.getByText('Zmiany oczekujące na wysłanie:', { exact: false })).toHaveCount(0);
    await page.reload();
    await expect(page.getByText('Zmiany do sprawdzenia: 2.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Sprawdź zmiany' }).click();
    const dialog = page.getByRole('dialog', { name: 'Zmiany wymagające sprawdzenia' });
    await expect(dialog.getByText('Stary lokalny tytuł', { exact: false })).toBeVisible();
    await expect(dialog.getByText('Zmiana czeka na rozstrzygnięcie', { exact: false })).toBeVisible();
    await expect(dialog.getByText('Termin: 2027-01-01')).toBeVisible();
    await expect(dialog).toHaveCSS('opacity', '1');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({
      path: info.outputPath(`task-review-${native}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    await dialog.getByRole('button', { name: 'Odrzuć łańcuch' }).click();
    await expect(dialog.getByText('Odrzucić cały pokazany łańcuch', { exact: false })).toBeVisible();
    await dialog.getByRole('button', { name: 'Zamknij' }).click();
    await expect(page.getByRole('button', { name: 'Sprawdź zmiany' })).toBeVisible();
    await page.getByRole('button', { name: 'Sprawdź zmiany' }).click();
    await dialog.getByRole('button', { name: 'Odrzuć łańcuch' }).click();
    await dialog.getByRole('button', { name: 'Potwierdź odrzucenie' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sprawdź zmiany' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('article', { name: 'Potwierdzone zadanie' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sprawdź zmiany' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
