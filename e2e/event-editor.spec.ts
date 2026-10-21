import { expect, test } from '@playwright/test';

test('failed save and rejected kind change retain the dirty full form', async ({ page, baseURL }, info) => {
  const registered = await page.request.post('/api/auth/register-family', {
    headers: { Origin: baseURL! },
    data: {
      familyName: 'Błąd zapisu',
      displayName: 'Ania',
      email: `editor-error-${info.project.name}@example.com`,
      password: 'password123',
    },
  });
  expect(registered.ok()).toBe(true);
  await page.goto('/kalendarz');
  await page.getByRole('button', { name: 'Dodaj wydarzenie', exact: true }).click();
  const form = page.getByRole('form', { name: 'Dodaj wydarzenie' });
  await form.getByLabel(/^Tytuł/).fill('Zachowaj wpisaną treść');
  page.once('dialog', (confirmation) => confirmation.dismiss());
  if (info.project.name === 'phone') {
    await page.getByRole('textbox', { name: 'Wybierz rodzaj wydarzenia', exact: true }).click();
    await page.getByRole('option', { name: 'Powtarzające się', exact: true }).click();
  } else await page.getByRole('button', { name: 'Powtarzające się', exact: true }).click();
  await expect(form.getByLabel(/^Tytuł/)).toHaveValue('Zachowaj wpisaną treść');
  await expect(form.getByLabel('Zakończenie', { exact: true })).toHaveCount(0);
  let attempted = false;
  await page.route('**/api/events', async (route) => {
    if (route.request().method() === 'POST' && !attempted) {
      attempted = true;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Próba błędu zapisu' } }),
      });
    } else await route.continue();
  });
  await form.getByRole('button', { name: 'Zapisz', exact: true }).click();
  await expect(form.getByRole('alert')).toContainText('Próba błędu zapisu');
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await form.getByRole('button', { name: 'Anuluj', exact: true }).click();
  await expect(form.getByLabel(/^Tytuł/)).toHaveValue('Zachowaj wpisaną treść');
  await form.getByRole('button', { name: 'Zapisz', exact: true }).click();
  await expect(form).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Kalendarz', exact: true })).toBeVisible();
});

for (const [kind, label] of [
  ['single', 'Jednorazowe'],
  ['recurring', 'Powtarzające się'],
  ['distant', 'Odległy termin'],
] as const) {
  test(`full event editor saves ${kind} and preserves personal reminders on edit`, async ({
    page,
    browser,
    baseURL,
  }, info) => {
    const headers = { Origin: baseURL! };
    const registered = await page.request.post('/api/auth/register-family', {
      headers,
      data: {
        familyName: 'Formularze',
        displayName: 'Ania',
        email: `editor-${kind}-${info.project.name}@example.com`,
        password: 'password123',
      },
    });
    expect(registered.ok()).toBe(true);
    const { family } = await registered.json();
    const child = await page.request.post('/api/members/child', {
      headers,
      data: { displayName: 'Zosia', pin: '1234', color: '#9677bb' },
    });
    expect(child.ok()).toBe(true);
    const { member } = await child.json();
    await page.goto('/kalendarz');
    await page.getByRole('button', { name: 'Dodaj wydarzenie', exact: true }).click();
    await expect(page).toHaveURL(/\/kalendarz$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (info.project.name === 'phone') {
      await page.getByRole('textbox', { name: 'Wybierz rodzaj wydarzenia', exact: true }).click();
      await page.getByRole('option', { name: label, exact: true }).click();
    } else await page.getByRole('button', { name: label, exact: true }).click();
    const form = page.getByRole('form', { name: 'Dodaj wydarzenie' });
    await form.getByLabel(/^Tytuł/).fill(`Rodzinne plany ${kind}`);
    await form.getByLabel('Opis', { exact: true }).fill('Opis prawdziwego wydarzenia');
    await form.getByRole('button', { name: 'Zosia', exact: true }).click();
    if (kind === 'single') await form.getByRole('switch', { name: 'Całodniowe' }).check();
    if (kind === 'distant') {
      await form.getByLabel('Dokładność terminu', { exact: true }).click();
      await page.getByRole('option', { name: 'Tylko miesiąc', exact: true }).click();
      await form.getByLabel(/^Data/).fill('2030-05');
    } else await form.getByLabel(/^Data/).fill('2030-05-06');
    if (kind === 'recurring') {
      await form.getByLabel('Zakończenie', { exact: true }).click();
      await page.getByRole('option', { name: 'Po określonej liczbie wystąpień', exact: true }).click();
      await form.getByRole('textbox', { name: 'Liczba wystąpień', exact: true }).fill('4');
    }
    await form.getByRole('button', { name: 'Dodaj przypomnienie', exact: true }).click();
    const detailsBox = (await form.getByRole('region', { name: 'Szczegóły wydarzenia', exact: true }).boundingBox())!;
    const remindersBox = (await form
      .getByRole('region', { name: 'Przypomnienia wspólne', exact: true })
      .boundingBox())!;
    if (info.project.name === 'phone') expect(remindersBox.y).toBeGreaterThan(detailsBox.y + detailsBox.height);
    else expect(remindersBox.x).toBeGreaterThan(detailsBox.x + detailsBox.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`editor-${kind}.png`), fullPage: true, animations: 'disabled' });
    const saved = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/events' && response.request().method() === 'POST',
    );
    await form.getByRole('button', { name: 'Zapisz', exact: true }).click();
    const response = await saved;
    expect(response.ok()).toBe(true);
    const { event } = await response.json();
    expect(event.kind).toBe(kind);
    if (kind === 'single') expect(event.startTime).toBeNull();
    if (kind === 'distant') {
      expect(event.datePrecision).toBe('month');
      expect(event.startDate).toBe('2030-05-01');
    }
    if (kind === 'recurring') expect(event.rrule).toContain('COUNT=4');
    await expect(form).not.toBeVisible();

    const other = await browser.newContext({ baseURL: baseURL! });
    try {
      const login = await other.request.post('/api/auth/login-child', {
        headers,
        data: { joinCode: family.joinCode, userId: member.id, pin: '1234' },
      });
      expect(login.ok()).toBe(true);
      const personal = await other.request.post('/api/reminders/mine', {
        headers,
        data: { eventId: event.id, type: 'offset', offsetValue: 1, offsetUnit: 'day' },
      });
      expect(personal.ok()).toBe(true);
      const personalBefore = (await (await other.request.get(`/api/reminders/mine?eventId=${event.id}`)).json())
        .reminders;
      await page.goto(`/kalendarz/wydarzenie/${event.id}`);
      await page.getByRole('button', { name: 'Edytuj', exact: true }).click();
      if (kind === 'recurring')
        await page.getByRole('dialog').getByRole('button', { name: 'Wszystkie', exact: true }).click();
      const edit = page.getByRole('dialog', { name: 'Edytuj wydarzenie', exact: true });
      await edit.getByLabel(/^Tytuł/).fill(`Po edycji ${kind}`);
      await edit.getByRole('button', { name: 'Zapisz', exact: true }).click();
      await expect(edit).not.toBeVisible();
      await expect(page.getByRole('heading', { name: `Po edycji ${kind}`, exact: true })).toBeVisible();
      expect((await (await other.request.get(`/api/reminders/mine?eventId=${event.id}`)).json()).reminders).toEqual(
        personalBefore,
      );
      await page.screenshot({ path: info.outputPath(`details-${kind}.png`), fullPage: true, animations: 'disabled' });
    } finally {
      await other.close();
    }
  });
}
