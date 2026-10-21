import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';
import { openNavigation } from './navigation.js';

for (const native of [false, true]) {
  test(`task catalog restores focus and scroll via ${native ? 'Android transport' : 'the website'}`, async ({
    page,
    baseURL,
  }, info) => {
    const headers = { Origin: baseURL! };
    expect(
      (
        await page.request.post('/api/auth/register-family', {
          headers,
          data: {
            familyName: 'Katalog zadań',
            displayName: 'Ania',
            email: `tasks-catalog-${native}-${info.project.name}@example.com`,
            password: 'password123',
          },
        })
      ).ok(),
    ).toBe(true);
    for (let index = 0; index < 12; index++) {
      expect((await page.request.post('/api/tasks/lists', { headers, data: { name: `Lista ${index}` } })).ok()).toBe(
        true,
      );
    }
    if (native) {
      await installNativeTransport(page);
      await page.addInitScript(() => {
        const listeners = new Map<string, (data: unknown) => void>();
        const bridge = (
          window as unknown as {
            Capacitor: {
              nativeCallback: unknown;
              PluginHeaders: { name: string; methods: { name: string; rtype: string }[] }[];
            };
          }
        ).Capacitor;
        bridge.PluginHeaders.find((plugin) => plugin.name === 'LocalNotifications')!.methods.push(
          { name: 'addListener', rtype: 'callback' },
          { name: 'removeListener', rtype: 'promise' },
        );
        bridge.PluginHeaders.find((plugin) => plugin.name === 'App')!.methods.push(
          { name: 'getLaunchUrl', rtype: 'promise' },
          { name: 'minimizeApp', rtype: 'promise' },
        );
        bridge.nativeCallback = (
          plugin: string,
          _method: string,
          options: { eventName: string },
          callback: (data: unknown) => void,
        ) => {
          listeners.set(`${plugin}:${options.eventName}`, callback);
          return 'task-listener';
        };
        Object.assign(window, {
          emitTaskNative: (event: string, data: unknown) => {
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            listeners.get(event)?.(data);
          },
        });
      });
    }
    const nativeEvent = (event: string, data: unknown = {}) =>
      page.evaluate(
        ({ event, data }) =>
          (window as unknown as { emitTaskNative: (event: string, data: unknown) => void }).emitTaskNative(event, data),
        { event, data },
      );
    await page.goto('/zadania');
    const catalog = page.getByRole('navigation', { name: 'Listy zadań' });
    const card = catalog.getByRole('link', { name: 'Lista 10', exact: true });
    await expect(card).toBeVisible();
    await page.screenshot({ path: info.outputPath(`tasks-catalog-${native}.png`), fullPage: true });
    await card.scrollIntoViewIfNeeded();
    const scroll = await page.evaluate(() => scrollY);
    await card.click();
    const heading = page.getByRole('heading', { name: 'Lista 10', exact: true });
    await expect(heading).toBeVisible();
    const phone = page.viewportSize()!.width < 768;
    if (phone) {
      await expect(heading).toBeFocused();
      await expect(catalog).not.toBeVisible();
    } else {
      await expect(catalog).toBeVisible();
    }
    await page.getByRole('textbox', { name: 'Dodaj zadanie', exact: true }).fill('Zadanie katalogu');
    await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
    const row = page.getByRole('article', { name: 'Zadanie katalogu', exact: true });
    await expect(row).toBeVisible();
    await page.context().setOffline(true);
    if (native)
      await page.evaluate(() => {
        localStorage.setItem('test:offline', 'yes');
        window.dispatchEvent(new Event('offline'));
      });
    await row.getByRole('checkbox').click();
    await expect(page.getByRole('button', { name: 'Zrobione (1)' })).toBeVisible();
    if (phone && native) await nativeEvent('App:backButton');
    else if (phone) await page.getByRole('button', { name: 'Wróć do list' }).click();
    else await page.goBack();
    if (phone) {
      await expect(card).toBeFocused();
      await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(scroll, 0);
    }
    await card.click();
    await page.getByRole('button', { name: 'Zrobione (1)' }).click();
    await expect(row.getByRole('checkbox')).toBeChecked();
    await page.screenshot({ path: info.outputPath(`tasks-catalog-offline-${native}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.context().setOffline(false);
    if (native)
      await page.evaluate(() => {
        localStorage.removeItem('test:offline');
        window.dispatchEvent(new Event('online'));
      });
    await expect(page.getByText(/Zmiany oczekujące na wysłanie/)).toHaveCount(0);
    const listId = new URL(page.url()).pathname.split('/').at(-1)!;
    const { tasks } = await (await page.request.get(`/api/tasks/lists/${listId}/tasks?status=all`)).json();
    const taskPath = `/zadania/${listId}?zadanie=${tasks[0].id}`;
    if (native)
      await nativeEvent('LocalNotifications:localNotificationActionPerformed', {
        notification: { extra: { url: taskPath } },
      });
    else await page.goto(taskPath);
    await expect(page.getByRole('dialog', { name: 'Edytuj zadanie' })).toBeVisible();
    if (native) await nativeEvent('App:backButton');
    else await page.getByRole('dialog').getByRole('button', { name: 'Anuluj' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (phone) {
      if (native) await nativeEvent('App:backButton');
      else await page.getByRole('button', { name: 'Wróć do list' }).click();
      await expect(catalog).toBeVisible();
      await expect(page).toHaveURL(/\/zadania$/);
    }
  });
  test(`clears completed tasks offline through ${native ? 'Android transport' : 'the website'}`, async ({
    page,
    baseURL,
  }, info) => {
    const headers = { Origin: baseURL! };
    const registration = await page.request.post('/api/auth/register-family', {
      headers,
      data: {
        familyName: 'Porządki',
        displayName: 'Ania',
        email: `tasks-clear-${native}-${info.project.name}@example.com`,
        password: 'password123',
      },
    });
    expect(registration.ok()).toBe(true);
    const { lists } = await (await page.request.get('/api/tasks/lists')).json();
    const listId = lists[0].id;
    const { list: other } = await (
      await page.request.post('/api/tasks/lists', { headers, data: { name: 'Inna lista' } })
    ).json();
    for (const [id, title, done] of [
      [listId, 'Otwarte zadanie', false],
      [listId, 'Gotowe pierwsze', true],
      [listId, 'Gotowe drugie', true],
      [other.id, 'Zadanie innej listy', true],
    ] as const) {
      const { task } = await (
        await page.request.post(`/api/tasks/lists/${id}/tasks`, { headers, data: { title } })
      ).json();
      if (done)
        expect((await page.request.patch(`/api/tasks/${task.id}`, { headers, data: { isDone: true } })).ok()).toBe(
          true,
        );
    }
    if (native) await installNativeTransport(page);
    await page.goto(`/zadania/${listId}`);
    await expect(page.getByRole('button', { name: 'Zrobione (2)' })).toBeVisible();
    await page.context().setOffline(true);
    if (native)
      await page.evaluate(() => {
        localStorage.setItem('test:offline', 'yes');
        window.dispatchEvent(new Event('offline'));
      });
    await expect(page.getByRole('alert').filter({ hasText: 'Jesteś offline' })).toBeVisible();
    await page.getByRole('button', { name: 'Wyczyść zrobione' }).click();
    const dialog = page.getByRole('dialog', { name: 'Wyczyść zrobione' });
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({
      path: info.outputPath(`tasks-clear-${native}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    await dialog.getByRole('button', { name: 'Anuluj' }).click();
    await expect(page.getByRole('button', { name: 'Zrobione (2)' })).toBeVisible();
    await page.getByRole('button', { name: 'Wyczyść zrobione' }).click();
    await dialog.getByRole('button', { name: 'Usuń', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Zrobione (0)' })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Otwarte zadanie', exact: true })).toBeVisible();
    await page.context().setOffline(false);
    if (native)
      await page.evaluate(() => {
        localStorage.removeItem('test:offline');
        window.dispatchEvent(new Event('online'));
      });
    await expect
      .poll(async () =>
        (await (await page.request.get(`/api/tasks/lists/${listId}/tasks?status=all`)).json()).tasks.map(
          (task: { title: string }) => task.title,
        ),
      )
      .toEqual(['Otwarte zadanie']);
    const remaining = await (await page.request.get(`/api/tasks/lists/${other.id}/tasks?status=all`)).json();
    expect(remaining.tasks).toHaveLength(1);
    await page.screenshot({ path: info.outputPath(`tasks-cleared-${native}.png`), fullPage: true });
  });
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
    await expect(page.getByRole('alert').filter({ hasText: 'Jesteś offline' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Edytuj zadanie' })).toBeVisible();
    await expect(page.getByRole('dialog').getByLabel('Notatka')).toHaveValue('Kod odbioru u mamy');
    await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Osoba przypisana' })).toBeDisabled();
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
