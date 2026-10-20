import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';
import { openNavigation } from './navigation.js';

for (const native of [false, true]) {
  test(`tasks support creation, completion, editing and polling through ${native ? 'Android transport' : 'the website'}`, async ({
    page,
    baseURL,
  }, info) => {
    test.setTimeout(60000);
    const headers = { Origin: baseURL! };
    const registration = await page.request.post('/api/auth/register-family', {
      headers,
      data: {
        familyName: 'Zadania',
        displayName: 'Ania',
        email: `tasks-${native}-${info.project.name}@example.com`,
        password: 'password123',
      },
    });
    expect(registration.ok()).toBe(true);
    if (native) await installNativeTransport(page);
    await page.goto('/zadania');
    await page.getByRole('navigation', { name: 'Listy zadań' }).getByRole('link', { name: 'Moje zadania' }).click();
    const listId = new URL(page.url()).pathname.split('/').at(-1)!;
    await page.getByRole('textbox', { name: 'Dodaj zadanie', exact: true }).fill('Odebrać paczkę');
    await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
    const task = page.getByRole('article', { name: 'Odebrać paczkę', exact: true });
    await expect(task).toBeVisible();
    await task.getByRole('link').click();
    const dialog = page.getByRole('dialog', { name: 'Edytuj zadanie' });
    await dialog.getByRole('textbox', { name: 'Tytuł', exact: true }).fill('Odebrać dużą paczkę');
    await dialog.getByLabel('Notatka').fill('Kod odbioru u mamy');
    await dialog.getByLabel('Termin', { exact: true }).fill('2020-01-02');
    await dialog.getByLabel('Godzina (opcjonalnie)').fill('16:45');
    await dialog.getByRole('textbox', { name: 'Osoba przypisana' }).click();
    await page.getByRole('option', { name: 'Ania', exact: true }).click();
    await page.screenshot({ path: info.outputPath(`tasks-form-${native}.png`), fullPage: true });
    await dialog.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    const edited = page.getByRole('article', { name: 'Odebrać dużą paczkę', exact: true });
    await expect(edited).toContainText('02.01.2020, 16:45 · po terminie');
    await expect(edited.getByLabel('Ania', { exact: true })).toBeVisible();
    const checkbox = edited.getByRole('checkbox');
    await checkbox.click();
    await expect(page.getByRole('button', { name: 'Zrobione (1)' })).toHaveAttribute('aria-expanded', 'false');
    await expect(edited).not.toBeVisible();
    await page.getByRole('button', { name: 'Zrobione (1)' }).click();
    await expect(checkbox).toBeChecked();
    await checkbox.click();
    await expect(page.getByRole('button', { name: 'Zrobione (0)' })).toBeVisible();
    const tasksResponse = await page.request.get(`/api/tasks/lists/${listId}/tasks?status=all`);
    const { tasks } = await tasksResponse.json();
    const taskId = tasks[0].id;
    await page.goto(`/zadania/${listId}?zadanie=${taskId}`);
    await expect(page.getByRole('dialog').getByLabel('Notatka')).toHaveValue('Kod odbioru u mamy');
    await page.getByRole('dialog').getByRole('button', { name: 'Anuluj' }).click();
    const remote = await page.request.post(`/api/tasks/lists/${listId}/tasks`, {
      headers,
      data: { title: 'Zadanie z drugiej sesji' },
    });
    expect(remote.ok()).toBe(true);
    await expect(page.getByRole('article', { name: 'Zadanie z drugiej sesji', exact: true })).toBeVisible({
      timeout: 21000,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`tasks-list-${native}.png`), fullPage: true });
    const navigation = await openNavigation(page);
    await expect(navigation.getByRole('link', { name: 'Zadania', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await navigation.getByRole('link', { name: 'Zadania', exact: true }).click();
    await page.getByRole('button', { name: 'Dodaj listę', exact: true }).click();
    await page.getByRole('dialog').getByRole('textbox', { name: 'Nazwa listy', exact: true }).fill('Remont łazienki');
    await page.getByRole('dialog').getByRole('button', { name: 'Dodaj', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Remont łazienki', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Dodaj zadanie ze szczegółami' }).click();
    await page.getByRole('dialog').getByRole('textbox', { name: 'Tytuł', exact: true }).fill('Wybrać płytki');
    await page.getByRole('dialog').getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Wybrać płytki', exact: true })).toBeVisible();
    await page.getByRole('article', { name: 'Wybrać płytki', exact: true }).getByRole('link').click();
    page.once('dialog', (confirmation) => confirmation.accept());
    await page.getByRole('button', { name: 'Usuń zadanie', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Wybrać płytki', exact: true })).toHaveCount(0);
    await page.goto(`/zadania/${listId}?zadanie=${taskId}`);
    await expect(page.getByRole('dialog', { name: 'Edytuj zadanie' })).toBeVisible();
    await page.context().setOffline(true);
    await expect(page.getByRole('alert').filter({ hasText: 'Prywatne szczegóły' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Edytuj zadanie' })).toHaveCount(0);
    await expect(page.getByText('Kod odbioru u mamy')).toHaveCount(0);
    await page.context().setOffline(false);
    await expect(page.getByRole('dialog', { name: 'Edytuj zadanie' })).toBeVisible({ timeout: 21000 });
  });
}

test('task URLs show access denied and missing tasks without revealing private content', async ({
  page,
  baseURL,
}, info) => {
  const headers = { Origin: baseURL! };
  const registration = await page.request.post('/api/auth/register-family', {
    headers,
    data: {
      familyName: 'Prywatność',
      displayName: 'Bartek',
      email: `task-denial-${info.project.name}@example.com`,
      password: 'password123',
    },
  });
  expect(registration.ok()).toBe(true);
  const lists = await (await page.request.get('/api/tasks/lists')).json();
  await page.goto(`/zadania/${lists.lists[0].id}?zadanie=10000000-0000-4000-8000-000000000009`);
  await expect(page.getByText('Zadanie jest niedostępne lub zostało usunięte.')).toBeVisible();
  await page.goto('/zadania/10000000-0000-4000-8000-000000000008?zadanie=10000000-0000-4000-8000-000000000009');
  await expect(page.getByText('Lista jest niedostępna lub nie masz do niej dostępu.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
