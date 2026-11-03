import { expect, test, type Page } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';

const title = 'Zajęcia w przedszkolu';
const date = '2026-11-12';
test.beforeEach(async ({ page, baseURL }, info) => {
  const registered = await page.request.post('/api/auth/register-family', {
    headers: { Origin: baseURL! },
    data: {
      familyName: 'Duplikaty',
      displayName: 'Anna',
      email: `duplicates-${info.testId}-${info.project.name}@example.com`,
      password: 'password123',
    },
  });
  expect(registered.ok()).toBe(true);
});
async function existing(page: Page, origin: string) {
  const response = await page.request.post('/api/events', {
    headers: { Origin: origin },
    data: {
      kind: 'single',
      title,
      startDate: date,
      startTime: '10:00',
      durationMinutes: 30,
      description: 'Poprzedni opis',
    },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).event;
}
async function occurrences(page: Page) {
  const response = await page.request.get(`/api/occurrences?from=${date}&to=${date}`);
  return (await response.json()).occurrences;
}
for (const platform of ['web', 'android'] as const) {
  for (const action of ['replace', 'add'] as const) {
    test(`${platform} calendar asks before ${action} of an event with the same title and date`, async ({
      page,
      baseURL,
    }, info) => {
      const original = await existing(page, baseURL!);
      if (platform === 'android') await installNativeTransport(page);
      await page.goto('/kalendarz');
      await page.getByRole('button', { name: 'Dodaj wydarzenie', exact: true }).click();
      const form = page.getByRole('form', { name: 'Dodaj wydarzenie' });
      await form.getByLabel(/^Tytuł/).fill(`  ${title.toUpperCase()}  `);
      await form.locator('input[type="date"]').fill(date);
      await form.getByLabel('Godzina (opcjonalnie)').fill('12:00');
      await form.getByLabel('Opis', { exact: true }).fill('Nowy opis');
      await form.getByRole('button', { name: 'Zapisz', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Takie wydarzenie już istnieje' });
      await expect(dialog).toBeVisible();
      expect(await occurrences(page)).toHaveLength(1);
      // Cancelling keeps the draft and does not change the existing event.
      await dialog.getByRole('button', { name: 'Anuluj', exact: true }).click();
      await expect(form.getByLabel('Opis', { exact: true })).toHaveValue('Nowy opis');
      await form.getByRole('button', { name: 'Zapisz', exact: true }).click();
      await expect(dialog).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`${platform}-${action}-dialog.png`), fullPage: true });
      await dialog
        .getByRole('button', { name: action === 'replace' ? 'Zastąp istniejące' : 'Dodaj kolejne', exact: true })
        .click();
      await expect(page.getByRole('heading', { name: 'Kalendarz', exact: true })).toBeVisible();
      const saved = await occurrences(page);
      expect(saved).toHaveLength(action === 'replace' ? 1 : 2);
      const current = (await (await page.request.get(`/api/events/${original.id}`)).json()).event;
      expect(current.description).toBe(action === 'replace' ? 'Nowy opis' : 'Poprzedni opis');
      expect(current.id).toBe(original.id);
    });
  }
}

for (const action of ['replace', 'add'] as const) {
  test(`photo import asks before ${action} and keeps the decision through lost response and restart`, async ({
    page,
    baseURL,
  }) => {
    const original = await existing(page, baseURL!);
    await page.goto('/kalendarz');
    await page.getByRole('button', { name: 'Dodaj ze zdjęcia', exact: true }).click();
    await page.getByRole('button', { name: 'Dodaj ręcznie propozycję' }).click();
    const form = page.getByRole('dialog', { name: 'Zatwierdź propozycję wydarzenia' });
    await form.getByLabel(/^Tytuł/).fill(title);
    await form.locator('input[type="date"]').fill(date);
    await form.getByLabel('Opis', { exact: true }).fill('Z importu');
    await form.getByRole('button', { name: 'Zatwierdź do paczki' }).click();
    await page.getByRole('checkbox', { name: `Wybierz do zapisu: ${title}` }).check();
    const sent: string[] = [];
    let lost = false;
    await page.route('**/api/events/import', async (route) => {
      const body = route.request().postDataJSON();
      if (body.items[0].duplicateResolution?.action === action) {
        sent.push(route.request().postData()!);
        if (!lost) {
          lost = true;
          const response = await route.fetch();
          expect((await response.json()).results[0].status).toBe('created');
          await route.abort('failed');
          return;
        }
      }
      await route.continue();
    });
    await page.getByRole('button', { name: 'Zapisz wybrane (1/20)' }).click();
    const dialog = page.getByRole('dialog', { name: 'Takie wydarzenie już istnieje' });
    await expect(dialog).toBeVisible();
    expect(await occurrences(page)).toHaveLength(1);
    await dialog
      .getByRole('button', { name: action === 'replace' ? 'Zastąp istniejące' : 'Dodaj kolejne', exact: true })
      .click();
    await expect(page.getByText(/Nie udało się zakończyć zapisu/)).toBeVisible();
    const changed = await page.request.patch(`/api/events/${original.id}`, {
      headers: { Origin: baseURL! },
      data: { description: 'Zmiana po imporcie' },
    });
    expect(changed.ok()).toBe(true);
    await page.reload();
    await page.getByRole('button', { name: 'Ponów nieznane wyniki (1)' }).click();
    await expect(page.getByText('Już zapisano wcześniej — bez duplikatu.')).toBeVisible();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(sent[0]);
    expect(await occurrences(page)).toHaveLength(action === 'replace' ? 1 : 2);
    expect((await (await page.request.get(`/api/events/${original.id}`)).json()).event.description).toBe(
      'Zmiana po imporcie',
    );
  });
}
