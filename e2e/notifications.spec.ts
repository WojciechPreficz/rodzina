import { expect, test } from '@playwright/test';

test('website explains APK reminders without browser push or installation prompts', async ({
  page,
  baseURL,
}, testInfo) => {
  const pushRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/push/')) pushRequests.push(request.url());
  });
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
  await expect(page.getByText('Włącz powiadomienia, aby dostawać przypomnienia')).toHaveCount(0);
  await page.getByRole('link', { name: 'Więcej', exact: true }).click();
  await page.getByRole('link', { name: 'Powiadomienia', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Powiadomienia', exact: true })).toBeVisible();
  await expect(page.getByText('Przypomnienia są dostępne w aplikacji na Androida.')).toBeVisible();
  await expect(page.getByText('Wydanie Androida jest obecnie niedostępne.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Włącz powiadomienia' })).toHaveCount(0);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('notifications.png'), fullPage: true });
  await page.getByRole('link', { name: 'Więcej', exact: true }).click();
  await page.getByRole('link', { name: 'Powiadomienia', exact: true }).click();
  await expect(page).toHaveURL(/\/wiecej\/powiadomienia$/);
  expect(pushRequests).toEqual([]);
});
