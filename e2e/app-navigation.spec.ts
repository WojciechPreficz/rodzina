import { expect, test } from '@playwright/test';
import { openNavigation } from './navigation.js';

test.beforeEach(async ({ page, baseURL }, info) => {
  const response = await page.request.post('/api/auth/register-family', {
    headers: { Origin: baseURL! },
    data: {
      familyName: 'Menu Rodziny',
      displayName: 'Anna',
      email: `menu-${info.testId}-${info.project.name}@example.com`,
      password: 'password123',
    },
  });
  expect(response.ok()).toBe(true);
});

test('website uses a left sidebar on desktop and a right drawer on phones', async ({ page }, info) => {
  const phone = info.project.name === 'phone';
  await page.goto('/');
  const navigation = await openNavigation(page);
  const accountMenu = page.locator('.app-navigation:visible');
  await expect(accountMenu.getByText('Anna', { exact: true })).toBeVisible();
  await expect(accountMenu.getByText('Administrator', { exact: true })).toBeVisible();
  await expect(accountMenu.getByText('Menu Rodziny', { exact: true })).toHaveCount(0);
  const links = navigation.getByRole('link');
  await expect(links).toHaveText(['Kalendarz', 'Zakupy', 'Obiady', 'Rodzina', 'Powiadomienia', 'Wersja aplikacji']);
  await expect(links.first()).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.mantine-AppShell-footer')).toHaveCount(0);
  const boxes = await links.evaluateAll((items) =>
    items.map((item) => {
      const { x, y, height } = item.getBoundingClientRect();
      return { x, y, height };
    }),
  );
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i]!.x).toBe(boxes[0]!.x);
    expect(boxes[i]!.y).toBeGreaterThanOrEqual(boxes[i - 1]!.y + boxes[i - 1]!.height);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (phone) {
    const dialog = page.getByRole('dialog', { name: 'Menu Rodziny' });
    await expect
      .poll(async () => {
        const bounds = (await dialog.boundingBox())!;
        return Math.round(bounds.x + bounds.width);
      })
      .toBe(390);
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThan(0);
    expect(box.x + box.width).toBeCloseTo(390, 0);
    await page.screenshot({ path: info.outputPath('phone-menu.png'), fullPage: true });
    await page.getByRole('button', { name: 'Zamknij menu' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Otwórz menu' })).toBeFocused();
    await openNavigation(page);
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await openNavigation(page);
    await page.locator('.mantine-Drawer-overlay').click({ position: { x: 10, y: 200 } });
    await expect(dialog).not.toBeVisible();
    await openNavigation(page);
  } else {
    const box = (await page.locator('.app-sidebar').boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.width).toBe(240);
    await expect(page.getByRole('button', { name: 'Otwórz menu' })).not.toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('desktop-navigation.png'), fullPage: true });
  }
  await navigation.getByRole('link', { name: 'Rodzina', exact: true }).click();
  await expect(page).toHaveURL(/\/wiecej\/rodzina$/);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const familyMenu = await openNavigation(page);
  await expect(familyMenu.locator('[aria-current="page"]')).toHaveText('Rodzina');
  await familyMenu.getByRole('link', { name: 'Wersja aplikacji' }).click();
  await expect(page.getByRole('heading', { name: 'Wersja aplikacji' })).toBeVisible();
  if (phone) {
    await openNavigation(page);
    await expect(page.getByRole('dialog', { name: 'Menu Rodziny' })).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    // The drawer keeps its navigation mounted until the exit transition finishes.
    await expect(page.getByRole('dialog', { name: 'Menu Rodziny' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Nawigacja główna' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('navigation', { name: 'Nawigacja główna' })).toHaveCount(0);
    await expect
      .poll(() => page.locator('main').evaluate((element) => getComputedStyle(element).paddingLeft))
      .toBe('16px');
    await page.screenshot({ path: info.outputPath('phone-page.png'), fullPage: true });
  }
});

test('APK uses the same right drawer and native Back closes it before leaving the page', async ({ page }, info) => {
  await page.addInitScript(() => {
    const callbacks = new Map<string, () => void>();
    let minimized = 0;
    const methods = {
      RodzinaApi: ['request', 'clearSession'],
      App: ['getLaunchUrl', 'getInfo', 'minimizeApp'],
      LocalNotifications: [],
    };
    Object.assign(window, {
      nativeBack: () => callbacks.get('App:backButton')?.(),
      minimized: () => minimized,
      CapacitorCustomPlatform: { name: 'android' },
      Capacitor: {
        PluginHeaders: Object.entries(methods).map(([name, names]) => ({
          name,
          methods: [
            ...names.map((name) => ({ name, rtype: 'promise' })),
            { name: 'addListener', rtype: 'callback' },
            { name: 'removeListener', rtype: 'promise' },
          ],
        })),
        nativeCallback: (plugin: string, _method: string, options: { eventName: string }, callback: () => void) => {
          const key = `${plugin}:${options.eventName}`;
          callbacks.set(key, callback);
          return key;
        },
        nativePromise: async (plugin: string, method: string, options: { path: string }) => {
          if (plugin === 'RodzinaApi' && method === 'request') {
            const response = await fetch(options.path, { credentials: 'include' });
            return { status: response.status, body: await response.text() };
          }
          if (method === 'getInfo') return { build: '1', version: '1.0.0' };
          if (method === 'minimizeApp') minimized++;
          return {};
        },
      },
    });
  });
  await page.goto('/');
  await openNavigation(page);
  const dialog = page.getByRole('dialog', { name: 'Menu Rodziny' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Anna', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Administrator', { exact: true })).toBeVisible();
  await expect(dialog.locator('.app-navigation').getByText('Menu Rodziny', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('android-menu.png'), fullPage: true });
  await page.evaluate(() => (window as unknown as { nativeBack: () => void }).nativeBack());
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => (window as unknown as { minimized: () => number }).minimized())).toBe(0);
  const menu = await openNavigation(page);
  await menu.getByRole('link', { name: 'Zakupy', exact: true }).click();
  await expect(page).toHaveURL(/\/zakupy$/);
  await expect(dialog).not.toBeVisible();
});
