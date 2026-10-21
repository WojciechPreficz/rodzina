import { expect, test } from '@playwright/test';

test('filters events by clicking member buttons', async ({ page, baseURL }, testInfo) => {
  const headers = { Origin: baseURL! };
  const registration = await page.request.post('/api/auth/register-family', {
    headers,
    data: {
      familyName: 'Filtry',
      displayName: 'Anna',
      email: `filters-${testInfo.project.name}@example.com`,
      password: 'password123',
    },
  });
  expect(registration.ok()).toBe(true);
  const { user } = await registration.json();
  const child = await page.request.post('/api/members/child', {
    headers,
    data: { displayName: 'Piotr', pin: '1234', color: '#1C7ED6' },
  });
  expect(child.ok()).toBe(true);
  const { member } = await child.json();
  for (const [title, participantIds] of [
    ['Termin Anny', [user.id]],
    ['Termin Piotra', [member.id]],
    ['Termin bez uczestników', []],
  ] as const) {
    const response = await page.request.post('/api/events', {
      headers,
      data: {
        title,
        participantIds,
        kind: 'distant',
        startDate: '2030-05-01',
        datePrecision: 'month',
        description: null,
        location: null,
        startTime: null,
        durationMinutes: null,
        rrule: null,
      },
    });
    expect(response.ok()).toBe(true);
  }
  await page.goto('/kalendarz');
  const filters = page.getByRole('group', { name: 'Pokaż tylko', exact: true });
  const anna = filters.getByRole('button', { name: 'Anna', exact: true });
  const piotr = filters.getByRole('button', { name: 'Piotr', exact: true });
  await expect(page.getByRole('combobox', { name: 'Pokaż tylko' })).toHaveCount(0);
  await expect(page.getByText('Termin bez uczestników', { exact: true })).toBeVisible();
  await anna.click();
  await expect(anna).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Termin Anny', { exact: true })).toBeVisible();
  await expect(page.getByText('Termin Piotra', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Termin bez uczestników', { exact: true })).toHaveCount(0);
  await piotr.focus();
  await page.keyboard.press('Space');
  await expect(piotr).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Termin Piotra', { exact: true })).toBeVisible();
  await expect(page.getByText('Termin Anny', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('member-filters.png') });
  await anna.click();
  await expect(page.getByText('Termin Anny', { exact: true })).toHaveCount(0);
  await piotr.click();
  await expect(page.getByText('Wszyscy domownicy', { exact: true })).toBeVisible();
  await expect(page.getByText('Termin bez uczestników', { exact: true })).toBeVisible();
  await expect(page.getByText('Termin Anny', { exact: true })).toBeVisible();
});

test('creates a single event and opens its deep link after reload and login', async ({ page, baseURL }, testInfo) => {
  const email = `calendar-${testInfo.project.name}@example.com`;
  const registration = await page.request.post('/api/auth/register-family', {
    headers: { Origin: baseURL! },
    data: { familyName: 'Kalendarz', displayName: 'Anna', email, password: 'password123' },
  });
  expect(registration.ok()).toBe(true);
  await page.goto('/kalendarz');
  await page.getByRole('button', { name: 'Dodaj wydarzenie', exact: true }).click();
  const dialog = page.getByRole('form', { name: 'Dodaj wydarzenie' });
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
  // Revoke the server session too: background preview requests may still refresh its cookie.
  await page.request.post('/api/auth/logout', { headers: { Origin: baseURL! } });
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

test('warm calendar keeps real periods, responsive views and occurrence links', async ({ page, baseURL }, info) => {
  const headers = { Origin: baseURL! };
  const registered = await page.request.post('/api/auth/register-family', {
    headers,
    data: {
      familyName: 'Nowy kalendarz',
      displayName: 'Ania',
      email: `warm-${info.project.name}@example.com`,
      password: 'password123',
    },
  });
  expect(registered.ok()).toBe(true);
  const { user, family } = await registered.json();
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: family.timezone }).format(new Date());
  const created = await page.request.post('/api/events', {
    headers,
    data: {
      title: 'Wspólne popołudnie',
      kind: 'single',
      startDate: today,
      datePrecision: 'day',
      startTime: '16:30',
      durationMinutes: 90,
      rrule: null,
      description: null,
      location: 'Park',
      participantIds: [user.id],
    },
  });
  expect(created.ok()).toBe(true);
  const { event } = await created.json();
  await page.goto('/kalendarz');
  const calendar = page.locator('.family-calendar');
  const input = calendar.getByLabel('Wybierz datę');
  await expect(input).toHaveValue(today);
  await expect(
    calendar.locator(info.project.name === 'phone' ? '.sx__week-agenda-wrapper' : '.sx__month-grid-wrapper'),
  ).toBeVisible();
  await expect(page.getByText('Wspólne popołudnie', { exact: true })).toBeVisible();
  const month = page.locator('.page-header-description');
  const initialMonth = await month.textContent();
  await calendar.getByRole('button', { name: 'Wybierz widok Miesiąc', exact: true }).click();
  await calendar.getByRole('button', { name: 'Następny okres' }).click();
  await expect(month).not.toHaveText(initialMonth!);
  await expect(page.getByText('Wspólne popołudnie', { exact: true })).toHaveCount(0);
  await calendar.getByRole('button', { name: 'Poprzedni okres' }).click();
  await expect(month).toHaveText(initialMonth!);
  await calendar.getByRole('button', { name: 'Dzisiaj', exact: true }).click();
  await expect(input).toHaveValue(today);
  const filter = page.getByRole('group', { name: 'Pokaż tylko', exact: true }).getByRole('button', { name: 'Ania' });
  expect((await filter.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await filter.click();
  await expect(filter).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Wspólne popołudnie', { exact: true })).toBeVisible();
  if (info.project.name === 'phone') {
    await calendar.getByRole('button', { name: 'Wybierz widok Tydzień', exact: true }).click();
    await expect(calendar.getByText('16:30', { exact: true })).toBeVisible();
    await expect(calendar.getByText('Park', { exact: true })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('warm-calendar.png'), fullPage: true, animations: 'disabled' });
  await page.getByText('Wspólne popołudnie', { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/kalendarz/wydarzenie/${event.id}\\?data=${today}$`));
  await expect(page.getByRole('heading', { name: 'Wspólne popołudnie' })).toBeVisible();
});
