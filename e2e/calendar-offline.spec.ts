import { expect, test, type Page } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';

async function navigate(page: Page, label: string) {
  const burger = page.getByRole('button', { name: 'Otwórz menu' });
  if (await burger.isVisible()) await burger.click();
  await page.getByRole('navigation').getByRole('link', { name: label, exact: true }).click();
}
for (const native of [false, true]) {
  test(`calendar offline ${native ? 'bundled frontend cold start' : 'open website'} and remote refresh`, async ({
    page,
    browser,
    baseURL,
  }, info) => {
    test.setTimeout(60000);
    const headers = { Origin: baseURL! };
    const email = `calendar-offline-${native}-${info.project.name}@example.com`;
    expect(
      (
        await page.request.post('/api/auth/register-family', {
          headers,
          data: {
            familyName: 'Kalendarz offline',
            displayName: 'Ania',
            email,
            password: 'password123',
          },
        })
      ).ok(),
    ).toBe(true);
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date());
    const ids: string[] = [];
    for (const [title, kind, startDate] of [
      ['Zajęcia offline', 'single', today],
      ['Do usunięcia', 'single', today],
      ['Odległy offline', 'distant', '2030-05-01'],
    ]) {
      const response = await page.request.post('/api/events', {
        headers,
        data: {
          title,
          kind,
          startDate,
          datePrecision: 'day',
          startTime: null,
          durationMinutes: null,
          rrule: null,
          description: 'Pełny zapisany opis wydarzenia',
          location: 'Warszawa',
          participantIds: [],
        },
      });
      expect(response.ok()).toBe(true);
      ids.push((await response.json()).event.id);
    }
    const other = await browser.newContext({ baseURL: baseURL! });
    try {
      await other.request.post('/api/auth/login', { headers, data: { email, password: 'password123' } });
      if (native) await installNativeTransport(page);
      await page.goto('/zakupy');
      // The account bootstrap downloads calendar details without visiting either calendar screen.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const saved = JSON.parse(localStorage.getItem('rodzina:calendar:v1') ?? '{}');
            return [
              saved.ranges?.filter((r: { complete: boolean }) => r.complete).length,
              Object.keys(saved.details ?? {}).length,
              Object.keys(saved.personal ?? {}).length,
            ];
          }),
        )
        .toEqual([3, 3, 3]);
      await navigate(page, 'Kalendarz');
      await page.getByRole('button', { name: 'Dodaj wydarzenie', exact: true }).click();
      const dialog = page.getByRole('form', { name: 'Dodaj wydarzenie' });
      await dialog.getByLabel(/^Tytuł/).fill('Nie wysyłaj offline');
      if (native) {
        await page.route('**/api/**', (route) => route.abort('internetdisconnected'));
        await page.evaluate(() => {
          localStorage.setItem('test:offline', 'yes');
          window.dispatchEvent(new Event('offline'));
        });
      } else await page.context().setOffline(true);
      await expect(dialog.getByRole('button', { name: 'Zapisz', exact: true })).toBeDisabled();
      await expect(dialog.getByRole('button', { name: 'Dodaj przypomnienie' })).toBeDisabled();
      page.once('dialog', (confirmation) => confirmation.accept());
      await dialog.getByRole('button', { name: 'Anuluj' }).click();
      await expect(dialog).not.toBeVisible();
      if (native) await page.reload();
      await expect(
        page.getByRole('status').filter({ hasText: 'kalendarz jest dostępny tylko do odczytu' }),
      ).toContainText('Ostatnie udane pobranie');
      await expect(page.getByRole('button', { name: 'Dodaj wydarzenie', exact: true })).toBeDisabled();
      await expect(page.getByText('Zajęcia offline', { exact: true }).first()).toBeVisible();
      const views = info.project.name === 'phone' ? ['Dzień', 'Miesiąc'] : ['Dzień', 'Tydzień'];
      for (const view of views) {
        await page.getByRole('button', { name: `Wybierz widok ${view}`, exact: true }).click();
        await expect(page.getByText('Zajęcia offline', { exact: true }).first()).toBeVisible();
        await expect(page.getByText(/Ten zakres nie został zapisany offline/)).toHaveCount(0);
      }
      const member = page
        .getByRole('group', { name: 'Pokaż tylko', exact: true })
        .getByRole('button', { name: 'Ania' });
      await member.click();
      await expect(page.getByText('Brak wydarzeń w wybranym zakresie.')).toBeVisible();
      await member.click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath('calendar-offline.png'), fullPage: true });
      await page.getByText('Zajęcia offline', { exact: true }).first().click();
      if (native) await page.reload();
      await expect(page.getByRole('heading', { name: 'Zajęcia offline' })).toBeVisible();
      await expect(page.getByText('Pełny zapisany opis wydarzenia')).toBeVisible();
      for (const name of ['Edytuj', 'Usuń wydarzenie', 'Dodaj przypomnienie'])
        await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
      await page.screenshot({ path: info.outputPath('calendar-details-offline.png'), fullPage: true });
      await page.getByRole('link', { name: 'Wróć do kalendarza' }).click();
      await page.getByRole('link').filter({ hasText: 'Odległy offline' }).click();
      await expect(page.getByRole('heading', { name: 'Odległy offline' })).toBeVisible();
      await page.getByRole('link', { name: 'Wróć do kalendarza' }).click();
      await navigate(page, 'Rodzina');
      await expect(page.getByRole('status')).toContainText('Jesteś offline');
      await expect(page.getByRole('button', { name: 'Dodaj dziecko' })).toBeDisabled();
      await navigate(page, 'Zakupy');
      if (info.project.name === 'phone') {
        await page.getByRole('button', { name: 'Zakupy', exact: true }).click();
      }
      await page.getByRole('textbox', { name: 'Dodaj produkt' }).fill('Mleko 2l');
      await page.getByRole('button', { name: 'Dodaj', exact: true }).click();
      await expect(page.getByRole('article', { name: 'Mleko', exact: true })).toBeVisible();
      await navigate(page, 'Kalendarz');
      await other.request.patch(`/api/events/${ids[0]}`, {
        headers,
        data: { title: 'Zmienione na drugim urządzeniu' },
      });
      await other.request.delete(`/api/events/${ids[1]}`, { headers });
      if (native) {
        await page.unroute('**/api/**');
        await page.evaluate(() => {
          localStorage.removeItem('test:offline');
          window.dispatchEvent(new Event('online'));
        });
      } else await page.context().setOffline(false);
      await expect(page.getByRole('button', { name: 'Dodaj wydarzenie', exact: true })).toBeEnabled();
      await expect(page.getByText('Zmienione na drugim urządzeniu', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Do usunięcia', { exact: true })).toHaveCount(0);
      await expect
        .poll(() =>
          page.evaluate((id) => JSON.parse(localStorage.getItem('rodzina:calendar:v1')!).details[id], ids[1]!),
        )
        .toBeUndefined();
      await expect
        .poll(() =>
          page.evaluate(() => JSON.parse(localStorage.getItem('rodzina:shopping:v1')!).clientState.mutations.length),
        )
        .toBe(0);
      await page.screenshot({ path: info.outputPath('calendar-reconnected.png'), fullPage: true });
    } finally {
      await page.context().setOffline(false);
      await other.close();
    }
  });
}
