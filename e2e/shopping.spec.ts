import { expect, test, type Page } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';

async function openInitialList(page: Page) {
  if (page.viewportSize()!.width < 768) {
    await page.getByRole('button', { name: 'Zakupy', exact: true }).click();
  }
}

async function showCatalog(page: Page) {
  if (page.viewportSize()!.width < 768) {
    await page.getByRole('button', { name: 'Wróć do list' }).click();
  }
}

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
  await installNativeTransport(page);
  await page.goto('/zakupy');
  await openInitialList(page);
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
    await openInitialList(page);
    await expect(page.getByRole('textbox', { name: 'Dodaj produkt' })).toBeVisible();
    const add = page.getByRole('textbox', { name: 'Dodaj produkt' });
    for (const text of ['mleko 2l', 'jajka 10 szt', 'chleb razowy']) {
      await add.fill(text);
      await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
      await expect(add).toBeEmpty();
    }
    const other = await second.newPage();
    await other.goto('/zakupy');
    await openInitialList(other);
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
    await expect(page.getByRole('heading', { name: /^Nabiał/ })).toBeVisible();
    await page.getByRole('button', { name: 'Wyczyść kupione' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Usuń', exact: true }).click();
    await expect(page.getByRole('article', { name: 'mleko', exact: true })).toHaveCount(0);
    await showCatalog(page);
    await page.getByRole('button', { name: 'Dodaj listę' }).click();
    await page.getByLabel('Nazwa listy').fill('Drogeria');
    await page.getByRole('dialog').getByRole('button', { name: 'Zapisz' }).click();
    await page.getByRole('button', { name: 'Drogeria' }).click();
    await page.getByRole('button', { name: 'Opcje listy' }).click();
    await page.getByRole('menuitem', { name: 'Zmień nazwę listy' }).click();
    await page.getByLabel('Nazwa listy').fill('Dom');
    await page.getByRole('dialog').getByRole('button', { name: 'Zapisz' }).click();
    await expect(page.getByRole('heading', { name: 'Dom', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Opcje listy' }).click();
    await page.getByRole('menuitem', { name: 'Usuń listę', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Usuń', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Dom', exact: true })).toHaveCount(0);
    await openInitialList(page);
    await expect(page.getByRole('article', { name: 'Jajka wiejskie', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Opcje: Jajka wiejskie' }).click();
    await page.getByRole('menuitem', { name: 'Usuń', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Usuń', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Jajka wiejskie', exact: true })).toHaveCount(0);
  } finally {
    await second.close();
  }
});

test('offline shopping survives restarting the bundled frontend and syncs to another session', async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(60000);
  const headers = { Origin: baseURL! };
  const email = `offline-${testInfo.project.name}@example.com`;
  expect(
    (
      await page.request.post('/api/auth/register-family', {
        headers,
        data: { familyName: 'Offline', displayName: 'Ania', email, password: 'password123' },
      })
    ).ok(),
  ).toBe(true);
  const lists = await page.request.get('/api/shopping/lists');
  const listId = (await lists.json()).lists[0].id;
  for (const name of ['Mleko', 'Chleb', 'Jajka'])
    expect((await page.request.post(`/api/shopping/lists/${listId}/items`, { headers, data: { name } })).ok()).toBe(
      true,
    );
  const otherContext = await browser.newContext({
    baseURL: baseURL!,
    viewport: testInfo.project.use.viewport!,
    serviceWorkers: 'block',
  });
  try {
    await otherContext.request.post('/api/auth/login', { headers, data: { email, password: 'password123' } });
    const other = await otherContext.newPage();
    await other.goto('/zakupy');
    await openInitialList(other);
    await expect(other.getByRole('article')).toHaveCount(3);
    await installNativeTransport(page);
    await page.goto('/zakupy');
    await openInitialList(page);
    await expect(page.getByRole('article')).toHaveCount(3);
    await page.context().route('**/api/**', (route) => route.abort('internetdisconnected'));
    await page.evaluate(() => {
      localStorage.setItem('test:offline', 'yes');
      window.dispatchEvent(new Event('offline'));
    });
    await page.context().setOffline(true);
    for (const name of ['Mleko', 'Chleb', 'Jajka']) {
      await page.getByRole('checkbox', { name: `Kupione: ${name}`, exact: true }).click();
      await expect(page.getByRole('checkbox', { name: `Kupione: ${name}`, exact: true })).toBeChecked();
    }
    await page.getByRole('textbox', { name: 'Dodaj produkt' }).fill('masło 2 szt');
    await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Dodaj produkt' })).toBeEmpty();
    await expect(page.getByText('Jesteś offline - zmiany zostaną wysłane po odzyskaniu połączenia')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => JSON.parse(localStorage.getItem('rodzina:shopping:v1')!).clientState.mutations.length),
      )
      .toBe(4);
    await page.screenshot({ path: testInfo.outputPath('shopping-offline.png'), fullPage: true });
    // Assets remain reachable here to model the frontend bundled inside APK.
    // A regular website has no service worker and cannot cold-start offline.
    const nativeContext = page.context();
    await page.close();
    await nativeContext.setOffline(false);
    const reopened = await nativeContext.newPage();
    await installNativeTransport(reopened);
    await reopened.goto('/zakupy');
    await openInitialList(reopened);
    await expect(reopened.getByRole('article')).toHaveCount(4);
    for (const name of ['Mleko', 'Chleb', 'Jajka'])
      await expect(reopened.getByRole('checkbox', { name: `Kupione: ${name}`, exact: true })).toBeChecked();
    await expect(reopened.getByRole('article', { name: 'masło', exact: true })).toContainText('2 szt');
    expect(await reopened.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await reopened.screenshot({ path: testInfo.outputPath('shopping-offline-restored.png'), fullPage: true });
    await nativeContext.unroute('**/api/**');
    await reopened.evaluate(() => {
      localStorage.removeItem('test:offline');
      window.dispatchEvent(new Event('online'));
    });
    await expect
      .poll(() =>
        reopened.evaluate(() => JSON.parse(localStorage.getItem('rodzina:shopping:v1')!).clientState.mutations.length),
      )
      .toBe(0);
    await expect(reopened.getByRole('alert')).toHaveCount(0);
    await expect(other.getByRole('article')).toHaveCount(4, { timeout: 21000 });
    for (const name of ['Mleko', 'Chleb', 'Jajka'])
      await expect(other.getByRole('checkbox', { name: `Kupione: ${name}`, exact: true })).toBeChecked();
    await expect(other.getByRole('article', { name: 'masło', exact: true })).toContainText('2 szt');
    await reopened.getByRole('button', { name: 'Otwórz menu' }).click();
    await reopened.getByRole('button', { name: 'Wyloguj się', exact: true }).click();
    await expect.poll(() => reopened.evaluate(() => localStorage.getItem('rodzina:shopping:v1'))).toBeNull();
    await reopened.close();
  } finally {
    await otherContext.close();
  }
});

test('shopping catalog restores focus and scroll, keeps offline edits and distinguishes missing cache', async ({
  page,
  baseURL,
}, info) => {
  const headers = { Origin: baseURL! };
  expect(
    (
      await page.request.post('/api/auth/register-family', {
        headers,
        data: {
          familyName: 'Katalog',
          displayName: 'Ania',
          email: 'catalog-' + info.project.name + '@example.com',
          password: 'password123',
        },
      })
    ).ok(),
  ).toBe(true);
  const { lists } = await (await page.request.get('/api/shopping/lists')).json();
  for (let index = 0; index < 14; index++) {
    expect(
      (await page.request.post('/api/shopping/lists', { headers, data: { name: 'Lista rodzinna ' + index } })).ok(),
    ).toBe(true);
  }
  await page.goto('/zakupy');
  await expect(page.getByRole('button', { name: 'Lista rodzinna 13', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('shopping-catalog.png'), fullPage: true });
  const phone = page.viewportSize()!.width < 768;
  const card = page.getByRole('button', { name: 'Lista rodzinna 10', exact: true });
  await card.scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => window.scrollY);
  await card.click();
  const title = page.getByRole('heading', { name: 'Lista rodzinna 10', exact: true });
  await expect(title).toBeVisible();
  if (phone) await expect(title).toBeFocused();
  await page.getByRole('textbox', { name: 'Dodaj produkt' }).fill('Jabłka 2 kg');
  await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Jabłka', exact: true })).toBeVisible();
  await page.context().setOffline(true);
  const checkbox = page.getByRole('checkbox', { name: 'Kupione: Jabłka', exact: true });
  // Checking moves the item to another section and replaces the input element.
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await expect(page.getByText('Jesteś offline - zmiany zostaną wysłane po odzyskaniu połączenia')).toBeVisible();
  await page.goBack();
  if (phone) {
    await expect(card).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(scroll, 0);
    await expect(page.getByRole('textbox', { name: 'Dodaj produkt' })).not.toBeVisible();
  }
  await card.click();
  await expect(page.getByRole('checkbox', { name: 'Kupione: Jabłka', exact: true })).toBeChecked();
  await showCatalog(page);
  await page.getByRole('button', { name: 'Lista rodzinna 13', exact: true }).click();
  await expect(page.getByText(/Brak zawartości tej listy na urządzeniu/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Dodaj produkt' })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('shopping-missing-cache.png'), fullPage: true });
  await page.context().setOffline(false);
  await expect(page.getByRole('textbox', { name: 'Dodaj produkt' })).toBeEnabled();
  await showCatalog(page);
  await card.click();
  await expect
    .poll(async () => {
      const response = await page.request.get('/api/shopping/lists');
      if (!response.ok()) return false;
      const all = (await response.json()).lists;
      const id = all.find((entry: { name: string }) => entry.name === 'Lista rodzinna 10').id;
      const items = await (await page.request.get('/api/shopping/lists/' + id + '/items')).json();
      return items.items[0]?.isChecked;
    })
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const width of [767, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(lists).toHaveLength(1);
});
