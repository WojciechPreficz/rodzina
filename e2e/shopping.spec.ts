import { expect, test } from '@playwright/test';

test('shopping uses the Android native API transport', async ({ page, baseURL }, testInfo) => {
  const headers = { Origin: baseURL! };
  expect(
    (
      await page.request.post('/api/auth/register-family', {
        headers,
        data: {
          familyName: 'Zakupy APK',
          displayName: 'Ania',
          email: `shopping-native-${testInfo.project.name}@example.com`,
          password: 'password123',
        },
      })
    ).ok(),
  ).toBe(true);
  await page.addInitScript(() => {
    const methods = {
      RodzinaApi: ['request', 'clearSession'],
      RodzinaAlarms: ['read', 'write', 'runtimeStatus'],
      LocalNotifications: ['checkPermissions', 'checkExactNotificationSetting', 'getAll'],
    };
    Object.assign(window, {
      CapacitorCustomPlatform: { name: 'android' },
      Capacitor: {
        PluginHeaders: Object.entries(methods).map(([name, names]) => ({
          name,
          methods: names.map((name) => ({ name, rtype: 'promise' })),
        })),
        nativePromise: async (
          plugin: string,
          method: string,
          options: { path: string; method: string; body?: string },
        ) => {
          if (plugin === 'RodzinaApi' && method === 'request') {
            const response = await fetch(options.path, {
              method: options.method,
              credentials: 'include',
              ...(options.body ? { body: options.body, headers: { 'Content-Type': 'application/json' } } : {}),
            });
            return { status: response.status, body: await response.text() };
          }
          if (method === 'read') return { value: null, revision: 'test' };
          if (method === 'runtimeStatus') return { backgroundRestricted: false };
          if (method === 'checkPermissions') return { display: 'denied' };
          if (method === 'checkExactNotificationSetting') return { exact_alarm: 'denied' };
          return { notifications: [] };
        },
      },
    });
  });
  await page.goto('/zakupy');
  await page.getByRole('textbox', { name: 'Dodaj produkt' }).fill('mleko 2l');
  await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
  const checkbox = page.getByRole('checkbox', { name: 'Kupione: mleko', exact: true });
  await expect(checkbox).toBeEnabled();
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await expect(page.getByText('kupił(a): Ania')).toBeVisible();
  await page.reload();
  await expect(checkbox).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('shopping-native.png'), fullPage: true });
});

test('shopping CRUD, permissions, layout and polling synchronize two household members', async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(60000);
  const headers = { Origin: baseURL! };
  const response = await page.request.post('/api/auth/register-family', {
    headers,
    data: {
      familyName: 'Zakupy',
      displayName: 'Ania',
      email: `shopping-${testInfo.project.name}@example.com`,
      password: 'password123',
    },
  });
  expect(response.ok()).toBe(true);
  const { family } = await response.json();
  const child = await page.request.post('/api/members/child', {
    headers,
    data: { displayName: 'Zosia', pin: '1234', color: '#1C7ED6' },
  });
  const { member } = await child.json();
  const second = await browser.newContext({
    baseURL: baseURL!,
    viewport: testInfo.project.use.viewport!,
    serviceWorkers: 'block',
  });
  try {
    const loggedIn = await second.request.post('/api/auth/login-child', {
      headers,
      data: { joinCode: family.joinCode, userId: member.id, pin: '1234' },
    });
    expect(loggedIn.ok()).toBe(true);
    await page.goto('/zakupy');
    await expect(page.getByRole('tab', { name: 'Zakupy', exact: true })).toBeVisible();
    const add = page.getByRole('textbox', { name: 'Dodaj produkt' });
    for (const text of ['mleko 2l', 'jajka 10 szt', 'chleb razowy']) {
      await add.fill(text);
      await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
      await expect(add).toBeEmpty();
    }
    const other = await second.newPage();
    await other.goto('/zakupy');
    await expect(other.getByRole('article', { name: 'mleko', exact: true })).toContainText('2l');
    await expect(other.getByRole('button', { name: 'Dodaj listę', exact: true })).toHaveCount(0);
    await expect(other.getByRole('button', { name: 'Opcje: mleko', exact: true })).toHaveCount(0);
    const start = Date.now();
    await other.getByRole('checkbox', { name: 'Kupione: mleko', exact: true }).click();
    await expect(other.getByRole('checkbox', { name: 'Kupione: mleko', exact: true })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Kupione: mleko', exact: true })).toBeChecked({ timeout: 21000 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(20500);
    testInfo.annotations.push({ type: 'polling', description: `${elapsed} ms` });
    await expect(page.getByRole('article', { name: 'mleko', exact: true })).toContainText('kupił(a): Zosia');
    await expect(other.getByRole('button', { name: 'Wyczyść kupione' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('shopping.png'), fullPage: true });
    await other.screenshot({ path: testInfo.outputPath('shopping-child.png'), fullPage: true });
    await page.getByRole('button', { name: 'Opcje: jajka' }).click();
    await page.getByRole('menuitem', { name: 'Edytuj', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Nazwa produktu').fill('Jajka wiejskie');
    await dialog.getByLabel('Kategoria').click();
    await page.getByRole('option', { name: 'Nabiał', exact: true }).click();
    await dialog.screenshot({ path: testInfo.outputPath('shopping-edit.png') });
    await dialog.getByRole('button', { name: 'Zapisz', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Nabiał', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Wyczyść kupione' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Usuń', exact: true }).click();
    await expect(page.getByRole('article', { name: 'mleko', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Dodaj listę' }).click();
    await page.getByLabel('Nazwa listy').fill('Drogeria');
    await page.getByRole('dialog').getByRole('button', { name: 'Zapisz' }).click();
    await page.getByRole('tab', { name: 'Drogeria' }).click();
    await page.getByRole('button', { name: 'Zmień nazwę listy' }).click();
    await page.getByLabel('Nazwa listy').fill('Dom');
    await page.getByRole('dialog').getByRole('button', { name: 'Zapisz' }).click();
    await expect(page.getByRole('tab', { name: 'Dom', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Usuń listę', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Usuń', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Dom', exact: true })).toHaveCount(0);
    await expect(page.getByRole('article', { name: 'Jajka wiejskie', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Opcje: Jajka wiejskie' }).click();
    await page.getByRole('menuitem', { name: 'Usuń', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Usuń', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Jajka wiejskie', exact: true })).toHaveCount(0);
  } finally {
    await second.close();
  }
});
