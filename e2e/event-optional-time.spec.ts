import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';

for (const platform of ['web', 'android'] as const) {
  test(`single events allow an irrelevant time and an unspecified duration through ${platform}`, async ({
    page,
    baseURL,
  }, info) => {
    const registered = await page.request.post('/api/auth/register-family', {
      headers: { Origin: baseURL! },
      data: {
        familyName: 'Bez godziny',
        displayName: 'Anna',
        email: `optional-${platform}-${info.project.name}@example.com`,
        password: 'password123',
      },
    });
    expect(registered.ok()).toBe(true);
    if (platform === 'android') await installNativeTransport(page);
    for (const time of ['', '18:30']) {
      await page.goto('/kalendarz');
      await page.getByRole('button', { name: 'Dodaj wydarzenie', exact: true }).click();
      const form = page.getByRole('form', { name: 'Dodaj wydarzenie' });
      const title = time ? 'Koncert bez długości' : 'Zajęcia w przedszkolu';
      await form.getByLabel(/^Tytuł/).fill(title);
      await form.locator('input[type="date"]').fill('2026-11-12');
      const clock = form.getByLabel('Godzina (opcjonalnie)');
      await expect(clock).toHaveValue('');
      await expect(clock).not.toHaveAttribute('required');
      if (time) {
        await clock.fill(time);
        const duration = form.getByLabel('Czas trwania (min, opcjonalnie)');
        await expect(duration).toHaveValue('');
        await expect(duration).not.toHaveAttribute('required');
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({
        path: info.outputPath(`${platform}-${time ? 'time-only' : 'date-only'}-form.png`),
        fullPage: true,
      });
      const saved = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/api/events' && response.request().method() === 'POST',
      );
      await form.getByRole('button', { name: 'Zapisz', exact: true }).click();
      const response = await saved;
      expect(response.ok()).toBe(true);
      const { event } = await response.json();
      expect(event.startTime).toBe(time || null);
      expect(event.durationMinutes).toBeNull();
      await page.locator('.family-calendar').getByLabel('Wybierz datę').fill('2026-11-12');
      const entry = page.locator('.family-calendar').getByText(title, { exact: true }).first();
      await expect(entry).toBeVisible();
      if (!time && info.project.name === 'phone')
        await expect(page.locator('.calendar-agenda-time').filter({ hasText: 'Bez godziny' }).first()).toBeVisible();
      await entry.click();
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(page.getByText(/Czas trwania \(min\): 0/)).toHaveCount(0);
      await expect(page.getByText(/^Data zakończenia:/)).toHaveCount(0);
      if (!time) await expect(page.getByText(/· Bez godziny/)).toBeVisible();
      await page.getByRole('button', { name: 'Edytuj', exact: true }).click();
      const edit = page.getByRole('form', { name: 'Edytuj wydarzenie' });
      await expect(edit.getByRole('switch', { name: 'Wielodniowe' })).not.toBeChecked();
      if (time) {
        await expect(edit.getByLabel('Godzina (opcjonalnie)')).toHaveValue(time);
        await expect(edit.getByLabel('Czas trwania (min, opcjonalnie)')).toHaveValue('');
      } else await expect(edit.getByRole('switch', { name: 'Bez godziny' })).toBeChecked();
      await edit.getByRole('button', { name: 'Anuluj', exact: true }).click();
    }
  });
}
