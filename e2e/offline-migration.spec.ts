import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';
import { readOfflineSnapshot } from './offlineDatabase.js';
import type { Snapshot } from '../apps/web/src/features/calendar/calendarOffline.js';

const fixture = JSON.parse(readFileSync('docs/offline/fixtures/legacy-valid.json', 'utf8')) as {
  entries: { key: string; value: unknown }[];
};

test('migrates legacy previews only after confirmation and restores both after an offline restart', async ({
  page,
}, info) => {
  await installNativeTransport(page);
  await page.addInitScript((entries) => {
    if (!localStorage.getItem('test:seeded')) {
      for (const entry of entries) localStorage.setItem(entry.key, JSON.stringify(entry.value));
      localStorage.setItem('test:seeded', 'yes');
    }
    localStorage.setItem('test:offline', 'yes');
  }, fixture.entries);
  await page.route('**/api/**', (route) => route.abort('internetdisconnected'));
  await page.goto('/wiecej/rodzina');
  const confirm = page.getByRole('button', { name: 'Potwierdzam zamknięcie starych kart — przenieś dane' });
  await expect(confirm).toBeVisible();
  expect(await readOfflineSnapshot(page, 'family')).toBeUndefined();
  expect(await page.evaluate(() => localStorage.getItem('rodzina:offline-data:v1'))).not.toBeNull();
  await page.screenshot({ path: info.outputPath('migration-confirmation.png'), fullPage: true });
  await confirm.click();
  await expect(page.getByText('TEST-CODE', { exact: true })).toBeVisible();
  await expect(confirm).toHaveCount(0);
  expect(
    await page.evaluate(() => [
      localStorage.getItem('rodzina:offline-data:v1'),
      localStorage.getItem('rodzina:calendar:v1'),
    ]),
  ).toEqual([null, null]);
  await page.reload();
  await expect(page.getByText('TEST-CODE', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Jesteś offline');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('migrated-family-offline.png'), fullPage: true });
  await page.goto('/kalendarz');
  await expect(page.getByRole('status').filter({ hasText: 'kalendarz jest dostępny tylko do odczytu' })).toBeVisible();
  const calendar = await readOfflineSnapshot<Snapshot>(page, 'calendar');
  expect(calendar?.ranges).toHaveLength(1);
  const event = Object.values(calendar!.details)[0]!.event;
  await page.goto(`/kalendarz/wydarzenie/${event.id}`);
  await expect(page.getByRole('heading', { name: event.title, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edytuj', exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('migrated-calendar-offline.png'), fullPage: true });
});

test('shows a storage denial while keeping the online family view usable', async ({ page, baseURL }, info) => {
  const email = `idb-denied-${info.project.name}@example.com`;
  expect(
    (
      await page.request.post('/api/auth/register-family', {
        headers: { Origin: baseURL! },
        data: { familyName: 'Bez pamięci', displayName: 'Ania', email, password: 'password123' },
      })
    ).ok(),
  ).toBe(true);
  await page.addInitScript(() => {
    Object.defineProperty(indexedDB, 'open', {
      value: () => {
        throw new DOMException('Denied', 'SecurityError');
      },
    });
  });
  await page.goto('/wiecej/rodzina');
  await expect(page.getByRole('alert')).toContainText('IndexedDB');
  await expect(page.getByText('Ania (Ty)', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('rodzina:offline-data:v1'))).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('storage-denied.png'), fullPage: true });
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date());
  expect(
    (
      await page.request.post('/api/events', {
        headers: { Origin: baseURL! },
        data: {
          title: 'Podgląd bez pamięci',
          kind: 'single',
          startDate: today,
          startTime: null,
          durationMinutes: null,
          rrule: null,
          datePrecision: 'day',
          description: null,
          location: null,
          participantIds: [],
        },
      })
    ).ok(),
  ).toBe(true);
  await page.goto('/kalendarz');
  await expect(page.getByText('Podgląd bez pamięci', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Nowy podgląd może być niedostępny po zamknięciu aplikacji/)).toBeVisible();
});
