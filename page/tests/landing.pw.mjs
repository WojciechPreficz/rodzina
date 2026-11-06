/* global document, window, getComputedStyle */
import { test, expect } from '@playwright/test';

test('renders the whole page without overflow, errors or external requests', async ({ page }, info) => {
  const errors = [];
  const external = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4178/') && !request.url().startsWith('data:'))
      external.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Mniej pamiętania.');
  await expect(page.getByRole('heading', { name: /Cała codzienność/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Zróbcie miejsce/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath('first-screen.png') });
  await page.screenshot({ path: info.outputPath('full-page.png'), fullPage: true });
  const overflow = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    elements: [...document.querySelectorAll('body *')]
      .filter(
        (element) => element.getClientRects().length && element.getBoundingClientRect().right > window.innerWidth + 1,
      )
      .map((element) => ({
        tag: element.tagName,
        class: element.className,
        right: element.getBoundingClientRect().right,
      })),
  }));
  expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
  const badElements = await page.evaluate(() =>
    [...document.querySelectorAll('body *')]
      .filter((element) => {
        if (element.closest('svg') || element.closest('.sr-only') || element.closest('.skip-link')) return false;
        const style = getComputedStyle(element);
        if (style.visibility === 'hidden' || style.display === 'none' || !element.getClientRects().length) return false;
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1) && style.position !== 'absolute'
        );
      })
      .map((element) => element.className),
  );
  expect(badElements).toEqual([]);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('navigates sections and opens and dismisses the mobile menu', async ({ page }, info) => {
  await page.goto('/');
  const menu = page.locator('.menu-toggle');
  if (info.project.name === 'phone') {
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(menu).toBeFocused();
    await menu.click();
  }
  await page.getByRole('navigation').getByRole('link', { name: 'Funkcje', exact: true }).click();
  await expect(page).toHaveURL(/#funkcje$/);
  if (info.project.name === 'phone') await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('link', { name: 'Zobacz, jak to działa' }).click();
  await expect(page).toHaveURL(/#funkcje$/);
});

test('switches accessible tabs and preserves checklist and shopping changes', async ({ page }) => {
  await page.goto('/');
  const calendar = page.getByRole('tab', { name: /Kalendarz dla wszystkich/ });
  await calendar.focus();
  await page.keyboard.press('ArrowDown');
  const tasks = page.getByRole('tab', { name: /Obowiązki/ });
  await expect(tasks).toBeFocused();
  await expect(tasks).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('checkbox', { name: /Podlać kwiaty/ }).check();
  await expect(page.locator('#task-progress')).toHaveText('1 / 3');
  await page.getByRole('tab', { name: /Lista, z którą/ }).click();
  await page.getByRole('checkbox', { name: /Mleko/ }).check();
  await tasks.click();
  await expect(page.getByRole('checkbox', { name: /Podlać kwiaty/ })).toBeChecked();
  await page.getByRole('tab', { name: /Lista, z którą/ }).click();
  await expect(page.getByRole('checkbox', { name: /Mleko/ })).toBeChecked();
  await page.getByRole('tab', { name: /Lista, z którą/ }).focus();
  await page.keyboard.press('Home');
  await expect(calendar).toBeFocused();
  await expect(page.getByRole('tabpanel')).toHaveCount(1);
});

test('adds meal ingredients once, preserves existing groceries and resets', async ({ page }) => {
  await page.goto('/');
  const add = page.getByRole('button', { name: /Dodaj składniki/ });
  await add.click();
  await expect(page.locator('#ingredient-list li')).toHaveCount(7);
  await expect(page.locator('#meal-status')).toContainText('Dodano 6 składników');
  await expect(page.locator('#ingredient-list li').first()).toHaveText('Mleko1 l');
  await page.locator('#add-ingredients').dispatchEvent('click');
  await expect(page.locator('#ingredient-list li')).toHaveCount(7);
  await page.getByRole('button', { name: 'Zacznij od nowa', exact: false }).click();
  await expect(page.locator('#ingredient-list li')).toHaveCount(1);
  await expect(page.locator('#ingredient-count')).toHaveText('1 produkt');
  await add.click();
  await expect(page.locator('#ingredient-list li')).toHaveCount(7);
});

test('supports FAQ, modal focus, Escape and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe('auto');
  const question = page.locator('summary').filter({ hasText: 'Czy cała rodzina może korzystać z aplikacji?' });
  await question.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'Logowanie dziecka' })).toBeVisible();
  await page.getByRole('link', { name: 'Logowanie dziecka' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('To podgląd strony. Rejestracja i logowanie będą dostępne w aplikacji.');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('link', { name: 'Logowanie dziecka' })).toBeFocused();
  const register = page.locator('.hero-actions [data-app-path="/register"]');
  await register.click();
  await page.getByRole('button', { name: 'Wracam do odkrywania' }).click();
  await expect(register).toBeFocused();
  await register.click();
  await page.getByRole('button', { name: 'Zamknij komunikat' }).click();
  await expect(dialog).not.toBeVisible();
});

test('uses configured application origin and rejects unsafe configuration', async ({ page }) => {
  await page.route('**/config.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: "window.APP_BASE_URL = 'https://app.example.test/some-path';",
    }),
  );
  await page.goto('/');
  for (const path of ['/register', '/login', '/login-child']) {
    const links = page.locator(`[data-app-path="${path}"]`);
    for (const link of await links.all()) await expect(link).toHaveAttribute('href', `https://app.example.test${path}`);
  }
  await page.unroute('**/config.js');
  await page.route('**/config.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: "window.APP_BASE_URL = 'javascript:alert(1)';" }),
  );
  await page.reload();
  await page.locator('.hero-actions [data-app-path="/register"]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('opens directly from disk without a server', async ({ page }) => {
  await page.goto(new URL('../index.html', import.meta.url).href);
  await page.getByRole('tab', { name: /Obowiązki/ }).click();
  await page.getByRole('checkbox', { name: /Podlać kwiaty/ }).check();
  await expect(page.locator('#task-progress')).toHaveText('1 / 3');
  await page.locator('.hero-actions [data-app-path="/register"]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
