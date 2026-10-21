import { expect, test } from '@playwright/test';

test('public 404 survives reload and returns through calendar authentication', async ({ page }, info) => {
  await page.goto('/nieznana/zagniezdzona?test=404');
  const title = page.getByRole('heading', { name: 'Nie znaleźliśmy tej strony.' });
  await expect(title).toBeVisible();
  await page.reload();
  await expect(title).toBeVisible();
  await expect(page.locator('main.auth-layout')).toBeVisible();
  await expect
    .poll(() => page.locator('.not-found-art img').evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('public-404.png'), fullPage: true });
  await page.getByRole('link', { name: 'Wróć do kalendarza' }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/login\?next=%2Fkalendarz$/);
  await expect(page.getByRole('heading', { name: 'Zaloguj się', exact: true })).toBeVisible();
});

test('signed-in 404 keeps the shell and returns to the calendar', async ({ page, baseURL }, info) => {
  const response = await page.request.post('/api/auth/register-family', {
    headers: { Origin: baseURL! },
    data: {
      familyName: 'Rodzina 404',
      displayName: 'Anna',
      email: `404-${info.project.name}@example.com`,
      password: 'password123',
    },
  });
  expect(response.ok()).toBe(true);
  await page.goto('/nieznana');
  const title = page.getByRole('heading', { name: 'Nie znaleźliśmy tej strony.' });
  await expect(title).toBeVisible();
  await page.reload();
  await expect(title).toBeVisible();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('[aria-current="page"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('signed-in-404.png'), fullPage: true });
  await page.getByRole('link', { name: 'Wróć do kalendarza' }).click();
  await expect(page).toHaveURL(/\/kalendarz$/);
  await expect(page.getByRole('heading', { name: 'Kalendarz', exact: true })).toBeVisible();
});
