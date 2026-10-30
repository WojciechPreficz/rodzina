import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';

for (const native of [false, true]) {
  test(`checklist editing, completion and offline persistence via ${native ? 'Android transport' : 'WWW'}`, async ({
    page,
    baseURL,
  }, info) => {
    test.setTimeout(90_000);
    const headers = { Origin: baseURL! };
    expect(
      (
        await page.request.post('/api/auth/register-family', {
          headers,
          data: {
            familyName: 'Podzadania',
            displayName: 'Ania',
            email: `checklist-${native}-${info.project.name}@example.com`,
            password: 'password123',
          },
        })
      ).ok(),
    ).toBe(true);
    const { lists } = await (await page.request.get('/api/tasks/lists')).json();
    const listId = lists[0].id;
    const response = await page.request.post(`/api/tasks/lists/${listId}/tasks`, {
      headers,
      data: { title: 'Porządki', dueDate: '2020-01-01' },
    });
    expect(response.ok()).toBe(true);
    const { task } = await response.json();
    let offline = false;
    await page.route('**/api/**', (route) => (offline ? route.abort('internetdisconnected') : route.continue()));
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => localStorage.getItem('test:offline') !== 'yes',
      }),
    );
    if (native) {
      await installNativeTransport(page);
      await page.addInitScript(() => {
        const callbacks = new Map<string, () => void>();
        const bridge = (
          window as unknown as {
            Capacitor: {
              nativeCallback: unknown;
              PluginHeaders: { name: string; methods: { name: string; rtype: string }[] }[];
            };
          }
        ).Capacitor;
        bridge.PluginHeaders.find((plugin) => plugin.name === 'App')!.methods.push(
          { name: 'getLaunchUrl', rtype: 'promise' },
          { name: 'minimizeApp', rtype: 'promise' },
        );
        bridge.nativeCallback = (
          plugin: string,
          _method: string,
          options: { eventName: string },
          callback: () => void,
        ) => {
          callbacks.set(`${plugin}:${options.eventName}`, callback);
          return 'checklist-listener';
        };
        Object.assign(window, {
          checklistBack: () => {
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            callbacks.get('App:backButton')?.();
          },
        });
      });
    }
    await page.goto(`/zadania/${listId}?zadanie=${task.id}`);
    const form = page.getByRole('dialog', { name: 'Edytuj zadanie' });
    const section = form.getByRole('region', { name: 'Podzadania' });
    const draft = section.getByRole('textbox', { name: 'Nowe podzadanie' });
    for (const title of ['Okna', 'Podłoga', 'Drzwi']) {
      await draft.fill(title);
      await draft.press('Enter');
      await expect(section.getByRole('checkbox', { name: title, exact: true })).toBeVisible();
      await expect(draft).toHaveValue('');
      await expect(draft).toBeEnabled();
      await expect(draft).toBeFocused();
    }
    await section.getByRole('button', { name: 'Edytuj podzadanie: Drzwi' }).click();
    await section.getByRole('textbox', { name: 'Nazwa podzadania' }).fill('Lustra');
    await section.getByRole('textbox', { name: 'Nazwa podzadania' }).press('Enter');
    await expect(section.getByRole('button', { name: 'Edytuj podzadanie: Lustra' })).toBeFocused();
    const up = section.getByRole('button', { name: 'Przenieś wyżej: Lustra' });
    await up.focus();
    await up.press('Enter');
    await expect(section.getByRole('checkbox').nth(0)).toHaveAccessibleName('Okna');
    await expect(section.getByRole('checkbox').nth(1)).toHaveAccessibleName('Lustra');
    await expect(section.getByRole('checkbox').nth(2)).toHaveAccessibleName('Podłoga');
    await expect(section.getByRole('button', { name: 'Edytuj podzadanie: Lustra' })).toBeFocused();
    page.once('dialog', (dialog) => dialog.accept());
    await section.getByRole('button', { name: 'Usuń podzadanie: Podłoga' }).click();
    await expect(section.getByRole('checkbox', { name: 'Podłoga', exact: true })).toHaveCount(0);
    await expect(draft).toBeFocused();
    await section.getByRole('checkbox', { name: 'Okna', exact: true }).click();
    await expect(section.getByText('Podzadania: 1 z 2')).toBeVisible();
    await expect(form.getByRole('button', { name: 'Ukończ zadanie', exact: true })).toBeEnabled();
    await page.screenshot({ path: info.outputPath(`checklist-${native}.png`), fullPage: true, animations: 'disabled' });
    expect(
      await section
        .getByRole('button', { name: 'Przenieś niżej: Okna' })
        .evaluate((el) => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })),
    ).toEqual(expect.objectContaining({ height: 44 }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toContain('niewykonane podzadania: 1');
      return dialog.dismiss();
    });
    await form.getByRole('button', { name: 'Ukończ zadanie', exact: true }).click();
    await expect(form.getByRole('button', { name: 'Ukończ zadanie', exact: true })).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await form.getByRole('button', { name: 'Ukończ zadanie', exact: true }).click();
    await form.getByRole('button', { name: 'Oznacz zadanie jako niewykonane' }).click();
    await expect(section.getByRole('checkbox', { name: 'Lustra', exact: true })).not.toBeChecked();

    // The same guard protects the parent draft even after a checklist operation.
    await form.getByLabel('Notatka', { exact: true }).fill('Szkic rodzica');
    await section.getByRole('checkbox', { name: 'Lustra', exact: true }).click();
    await expect(section.getByText('Podzadania: 2 z 2')).toBeVisible();
    await expect(form.getByRole('button', { name: 'Anuluj', exact: true })).toBeEnabled();
    page.once('dialog', (dialog) => dialog.dismiss());
    if (native) await page.evaluate(() => (window as unknown as { checklistBack: () => void }).checklistBack());
    else await form.getByRole('button', { name: 'Anuluj', exact: true }).click();
    await expect(form).toBeVisible();
    await expect(form.getByLabel('Notatka', { exact: true })).toHaveValue('Szkic rodzica');
    await form.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(page.getByRole('article', { name: 'Porządki' }).getByText('Podzadania: 2 z 2')).toBeVisible();
    await expect(page.getByRole('article').getByRole('checkbox')).not.toBeChecked();
    await page.goto('/kalendarz');
    await expect(page.getByRole('region', { name: 'Dziś do zrobienia' }).getByText('Podzadania: 2 z 2')).toBeVisible({
      timeout: 15000,
    });

    await page.goto(`/zadania/${listId}?zadanie=${task.id}`);
    await expect(draft).toBeEnabled();
    offline = true;
    await page.evaluate(() => {
      localStorage.setItem('test:offline', 'yes');
      window.dispatchEvent(new Event('offline'));
    });
    await draft.fill('Offline');
    await draft.press('Enter');
    await expect(draft).toHaveValue('');
    await expect(draft).toBeEnabled();
    await expect(section.getByRole('checkbox', { name: 'Offline', exact: true })).toBeVisible();
    await page.reload();
    await expect(section.getByRole('checkbox', { name: 'Offline', exact: true })).toBeVisible();
    await expect(section.getByText('Podzadania: 2 z 3')).toBeVisible();
    await draft.fill('Niezapisany szkic');
    page.once('dialog', (dialog) => dialog.dismiss());
    if (native) await page.evaluate(() => (window as unknown as { checklistBack: () => void }).checklistBack());
    else await form.getByRole('button', { name: 'Anuluj', exact: true }).click();
    await expect(draft).toHaveValue('Niezapisany szkic');
    await draft.fill('');
    // Emptying a draft leaves no content to lose; explicit discard closes the editor.
    page.once('dialog', (dialog) => dialog.accept());
    await form.getByRole('button', { name: 'Anuluj', exact: true }).click();
    await expect(form).toHaveCount(0);
    offline = false;
    await page.evaluate(() => {
      localStorage.removeItem('test:offline');
      window.dispatchEvent(new Event('online'));
    });
    await expect(page.getByText(/Zmiany oczekujące na wysłanie:/)).toHaveCount(0);
    const saved = await (await page.request.get(`/api/tasks/${task.id}/checklist`)).json();
    expect(saved.items.map((item: { title: string }) => item.title)).toEqual(['Okna', 'Lustra', 'Offline']);
    expect(saved.items.filter((item: { isDone: boolean }) => item.isDone)).toHaveLength(2);
  });
}

test('checklist storage failures and conflicts keep drafts and expose a review action', async ({
  page,
  baseURL,
}, info) => {
  const headers = { Origin: baseURL! };
  expect(
    (
      await page.request.post('/api/auth/register-family', {
        headers,
        data: {
          familyName: 'Błędy checklisty',
          displayName: 'Ania',
          email: `checklist-errors-${info.project.name}@example.com`,
          password: 'password123',
        },
      })
    ).ok(),
  ).toBe(true);
  const { lists } = await (await page.request.get('/api/tasks/lists')).json();
  const response = await page.request.post(`/api/tasks/lists/${lists[0].id}/tasks`, {
    headers,
    data: { title: 'Błędy' },
  });
  const { task } = await response.json();
  await page.goto(`/zadania/${lists[0].id}?zadanie=${task.id}`);
  const section = page.getByRole('region', { name: 'Podzadania' });
  const draft = section.getByRole('textbox', { name: 'Nowe podzadanie' });
  await expect(draft).toBeEnabled();
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args: Parameters<typeof add>) {
      if (this.name === 'outbox') throw new DOMException('Brak miejsca na urządzeniu', 'QuotaExceededError');
      return add.apply(this, args);
    };
    Object.assign(window, {
      restoreChecklistStorage: () => {
        IDBObjectStore.prototype.add = add;
      },
    });
  });
  await draft.fill('Ważny krok');
  await section.getByRole('button', { name: 'Dodaj podzadanie' }).click();
  await expect(section.getByRole('alert')).toContainText(/Brak miejsca|pamięci|zapisać/);
  await expect(draft).toHaveValue('Ważny krok');
  await expect(section.getByRole('checkbox')).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { restoreChecklistStorage: () => void }).restoreChecklistStorage());
  await page.route('**/api/tasks/*/checklist?*', (route) =>
    route.fulfill({
      status: 409,
      json: { error: { code: 'OPERATION_CONFLICT', message: 'Podzadania zmieniono na innym urządzeniu.' } },
    }),
  );
  await section.getByRole('button', { name: 'Dodaj podzadanie' }).click();
  await expect(page.getByText(/Zamknij formularz i wybierz/)).toBeVisible();
  await expect(draft).toHaveValue('Ważny krok');
  await expect(section.getByRole('checkbox')).toHaveCount(0);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Anuluj', exact: true }).click();
  await page.getByRole('button', { name: 'Sprawdź zmiany' }).click();
  await expect(page.getByRole('dialog', { name: 'Zmiany wymagające sprawdzenia' })).toContainText('Dodanie podzadania');
  await expect(page.getByRole('dialog', { name: 'Zmiany wymagające sprawdzenia' })).toContainText('Ważny krok');
});
