import { expect, test } from '@playwright/test';

test('notification settings and reminder banner fit the screen', async ({ page, baseURL }, testInfo) => {
  const registration = await page.request.post('/api/auth/register-family', {
    headers: { Origin: baseURL! },
    data: {
      familyName: 'Powiadomienia',
      displayName: 'Anna',
      email: `push-${testInfo.project.name}@example.com`,
      password: 'password123',
    },
  });
  expect(registration.ok()).toBe(true);
  const created = await page.request.post('/api/events', {
    headers: { Origin: baseURL! },
    data: {
      title: 'Wizyta',
      kind: 'single',
      datePrecision: 'day',
      startDate: '2099-01-01',
      startTime: null,
      durationMinutes: null,
      rrule: null,
      description: null,
      location: null,
      participantIds: [],
      reminders: [{ type: 'offset', offsetValue: 1, offsetUnit: 'day', audience: 'owner' }],
    },
  });
  expect(created.ok()).toBe(true);
  await page.goto('/kalendarz');
  await expect(page.getByText('Włącz powiadomienia, aby dostawać przypomnienia')).toBeVisible();
  await page.getByRole('link', { name: 'Powiadomienia', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Powiadomienia', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Powiadomienia');
  await expect(page.getByText(/Otwórz aplikację w Chrome/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('notifications.png'), fullPage: true });
  await page.getByRole('link', { name: 'Więcej', exact: true }).click();
  await page.getByRole('link', { name: 'Powiadomienia', exact: true }).click();
  await expect(page).toHaveURL(/\/wiecej\/powiadomienia$/);
});
