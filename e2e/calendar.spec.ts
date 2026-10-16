import { expect, test } from '@playwright/test';

test('creates a single event and opens its deep link after reload and login', async ({ page, baseURL }, testInfo) => {
  const email = `calendar-${testInfo.project.name}@example.com`;
  const registration = await page.request.post('/api/auth/register-family', {
    headers: { Origin: baseURL! },
    data: { familyName: 'Kalendarz', displayName: 'Anna', email, password: 'password123' },
  });
  expect(registration.ok()).toBe(true);
  await page.goto('/kalendarz');
  await page.getByRole('button', { name: 'Dodaj wydarzenie', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Jednorazowe', exact: true }).click();
  await dialog.getByLabel(/^Tytuł/).fill('Wizyta u lekarza');
  await dialog.getByLabel(/^Data/).fill('2026-10-12');
  const created = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/events' && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Zapisz', exact: true }).click();
  const { event } = await (await created).json();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/\/kalendarz$/);
  const detailsUrl = `/kalendarz/wydarzenie/${event.id}?data=2026-10-12`;
  await page.goto(detailsUrl);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Wizyta u lekarza' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.context().clearCookies();
  await page.goto(detailsUrl);
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Hasło', { exact: true }).fill('password123');
  await page.getByRole('button', { name: 'Zaloguj się', exact: true }).click();
  await expect(page).toHaveURL(new URL(detailsUrl, baseURL).toString());
  await expect(page.getByRole('heading', { name: 'Wizyta u lekarza' })).toBeVisible();
  await page.goto(detailsUrl.replace('2026-10-12', '2026-10-13'));
  await expect(page.getByRole('status')).toHaveText('Tego wydarzenia już nie ma');
  await page.goto(detailsUrl);
  page.once('dialog', (confirmation) => confirmation.accept());
  await page.getByRole('button', { name: 'Usuń wydarzenie' }).click();
  await expect(page).toHaveURL(/\/kalendarz$/);
  await page.goto(detailsUrl);
  await expect(page.getByRole('status')).toHaveText('Tego wydarzenia już nie ma');
});
