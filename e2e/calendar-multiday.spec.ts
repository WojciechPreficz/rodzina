import { expect, test } from '@playwright/test';

test('creates and edits timed and all-day multi-day events', async ({ page, baseURL }, info) => {
  const registration = await page.request.post('/api/auth/register-family', {
    headers: { Origin: baseURL! },
    data: {
      familyName: 'Wyjazdy',
      displayName: 'Anna',
      email: `multiday-${info.project.name}@example.com`,
      password: 'password123',
    },
  });
  expect(registration.ok()).toBe(true);
  await page.goto('/kalendarz');
  await page.getByRole('button', { name: 'Dodaj wydarzenie', exact: true }).click();
  const form = page.getByRole('form', { name: 'Dodaj wydarzenie' });
  await form.getByLabel(/^Tytuł/).fill('Wyjazd rodzinny');
  await form.getByLabel(/^Data/).fill('2026-10-24');
  await form.getByRole('switch', { name: 'Wielodniowe' }).check();
  await form.getByLabel(/^Data zakończenia/).fill('2026-10-26');
  await form.getByLabel(/^Godzina zakończenia/).fill('12:00');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('multiday-form.png'), fullPage: true });
  const created = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/events' && response.request().method() === 'POST',
  );
  await form.getByRole('button', { name: 'Zapisz', exact: true }).click();
  const response = await created;
  expect(response.ok()).toBe(true);
  const { event } = await response.json();
  expect(event.durationMinutes).toBe(3120);
  await page.goto(`/kalendarz/wydarzenie/${event.id}`);
  await page.getByRole('button', { name: 'Edytuj', exact: true }).click();
  const edit = page.getByRole('form', { name: 'Edytuj wydarzenie' });
  await expect(edit.getByRole('switch', { name: 'Wielodniowe' })).toBeChecked();
  await expect(edit.getByLabel(/^Data zakończenia/)).toHaveValue('2026-10-26');
  await expect(edit.getByLabel(/^Godzina zakończenia/)).toHaveValue('12:00');
  await edit.getByRole('switch', { name: 'Całodniowe' }).check();
  await expect(edit.getByLabel(/^Godzina zakończenia/)).toHaveCount(0);
  const updated = page.waitForResponse((response) => response.request().method() === 'PATCH');
  await edit.getByRole('button', { name: 'Zapisz', exact: true }).click();
  expect((await updated).ok()).toBe(true);
  await page.reload();
  await expect(page.getByText(/Data zakończenia: 26 października 2026/)).toBeVisible();
  await page.getByRole('button', { name: 'Edytuj', exact: true }).click();
  await expect(edit.getByRole('switch', { name: 'Całodniowe' })).toBeChecked();
  await expect(edit.getByLabel(/^Data zakończenia/)).toHaveValue('2026-10-26');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('multiday-all-day.png'), fullPage: true });
});
