import { expect, test } from '@playwright/test';

// A device in another time zone must still display Polish civil dates unchanged.
test.use({ timezoneId: 'Pacific/Honolulu' });

test('holiday layers work in every view, persist independently and remain available offline', async ({
  page,
  baseURL,
}, info) => {
  const registration = await page.request.post('/api/auth/register-family', {
    headers: { Origin: baseURL! },
    data: {
      familyName: 'Święta',
      displayName: 'Anna',
      email: `holidays-${info.project.name}@example.com`,
      password: 'password123',
    },
  });
  expect(registration.ok()).toBe(true);
  await page.goto('/kalendarz');
  const calendar = page.locator('.family-calendar');
  const date = calendar.getByLabel('Wybierz datę');
  const publicHolidays = page.getByRole('switch', { name: 'Święta ustawowe', exact: true });
  const observances = page.getByRole('switch', { name: 'Dni okolicznościowe', exact: true });
  await expect(publicHolidays).toBeChecked();
  await expect(observances).toBeChecked();
  await date.fill('2026-05-26');
  const mother = calendar.getByText('Dzień Matki · Dzień okolicznościowy', { exact: true });
  await expect(mother).toBeVisible();
  await page
    .getByRole('group', { name: 'Pokaż tylko', exact: true })
    .getByRole('button', { name: 'Anna', exact: true })
    .click();
  await expect(mother).toBeVisible();
  await mother.click();
  const details = page.getByRole('dialog', { name: 'Dzień Matki', exact: true });
  await expect(details).toContainText('wtorek, 26 maja 2026');
  await expect(details).toContainText('Nie jest ustawowym dniem wolnym od pracy');
  await expect(details.getByRole('button', { name: /Edytuj|Usuń|przypomnienie/ })).toHaveCount(0);
  await expect(page).toHaveURL(/\/kalendarz$/);
  await details.getByRole('button', { name: 'Zamknij' }).click();

  for (const view of ['Tydzień', 'Dzień', 'Miesiąc']) {
    await calendar.getByRole('button', { name: `Wybierz widok ${view}`, exact: true }).click();
    await expect(mother).toBeVisible();
  }
  await publicHolidays.uncheck();
  await expect(mother).toBeVisible();
  await observances.uncheck();
  await expect(mother).toHaveCount(0);
  await page.reload();
  await expect(publicHolidays).not.toBeChecked();
  await expect(observances).not.toBeChecked();
  await publicHolidays.check();
  await observances.check();

  // Both categories coincide on this date; neither may replace the other.
  await date.fill('2031-06-01');
  await expect(calendar.getByText('Dzień Dziecka · Dzień okolicznościowy', { exact: true })).toBeVisible();
  await expect(calendar.getByText('Pierwszy dzień Zielonych Świątek · Święto ustawowe', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('holiday-layers.png'), fullPage: true, animations: 'disabled' });

  await page.context().setOffline(true);
  await date.fill('2026-12-24');
  const christmasEve = calendar.getByText('Wigilia Bożego Narodzenia · Święto ustawowe', { exact: true });
  await expect(christmasEve).toBeVisible();
  await christmasEve.click();
  const holidayDetails = page.getByRole('dialog', { name: 'Wigilia Bożego Narodzenia', exact: true });
  await expect(holidayDetails).toContainText('czwartek, 24 grudnia 2026');
  await expect(holidayDetails.getByText('Dzień ustawowo wolny od pracy', { exact: true })).toBeVisible();
  await holidayDetails.getByRole('button', { name: 'Zamknij' }).click();
  await publicHolidays.uncheck();
  await expect(christmasEve).toHaveCount(0);
  await date.fill('2026-12-06');
  await expect(calendar.getByText('Mikołajki · Dzień okolicznościowy', { exact: true })).toBeVisible();
  await date.fill('2100-01-01');
  await expect(page.getByText('Święta i dni okolicznościowe są dostępne dla lat 2025–2099.')).toBeVisible();
  await expect(calendar.getByText('Nowy Rok · Święto ustawowe', { exact: true })).toHaveCount(0);
});

test('holiday layers survive an events API error', async ({ page, baseURL }, info) => {
  const registered = await page.request.post('/api/auth/register-family', {
    headers: { Origin: baseURL! },
    data: {
      familyName: 'Święta bez API',
      displayName: 'Anna',
      email: `holiday-error-${info.project.name}@example.com`,
      password: 'password123',
    },
  });
  expect(registered.ok()).toBe(true);
  await page.route('**/api/occurrences?*', (route) =>
    route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR', message: 'Testowy błąd wydarzeń' } } }),
  );
  await page.goto('/kalendarz');
  const calendar = page.locator('.family-calendar');
  await calendar.getByLabel('Wybierz datę').fill('2026-02-14');
  await expect(page.getByText('Testowy błąd wydarzeń', { exact: false }).first()).toBeVisible();
  await expect(calendar.getByText('Walentynki · Dzień okolicznościowy', { exact: true })).toBeVisible();
});
