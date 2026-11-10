import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';
import { readOfflineSnapshot } from './offlineDatabase.js';
import type { Snapshot } from '../apps/web/src/features/calendar/index.js';

const fixture = JSON.parse(readFileSync('test-fixtures/offline/legacy-valid.json', 'utf8')) as {
  entries: { key: string; value: unknown }[];
  ids: { bread: string; shoppingEdit: string };
};

test('recovers a dormant WWW profile after a legacy tab writes during migration', async ({ context, page }) => {
  const legacyTab = await context.newPage();
  await legacyTab.route('**/legacy-tab', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Legacy client</title>' }),
  );
  await legacyTab.goto('/legacy-tab');
  const legacySources = await legacyTab.evaluate((entries) => {
    for (const { key, value } of entries) localStorage.setItem(key, JSON.stringify(value));
    return Object.fromEntries(Object.entries(localStorage));
  }, fixture.entries);
  expect(await legacyTab.evaluate(() => indexedDB.databases())).toEqual([]);

  const familyKey = 'rodzina:offline-data:v1';
  const family = JSON.parse(legacySources[familyKey]!) as { session: { family: { joinCode: string } } };
  family.session.family.joinCode = 'TEST-NEW';
  const updatedFamily = JSON.stringify(family);
  await page.exposeFunction('writeFromLegacyTab', async () => {
    await legacyTab.evaluate(({ key, value }) => localStorage.setItem(key, value), {
      key: familyKey,
      value: updatedFamily,
    });
  });
  // Simulate loss of API access while serving the updated WWW shell.
  await context.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
  await context.route('**/api/**', (route) => route.abort('internetdisconnected'));
  await page.goto('/wiecej/rodzina');
  const confirm = page.getByRole('button', { name: 'Potwierdzam zamknięcie starych kart — przenieś dane' });
  await expect(confirm).toBeVisible();
  expect(await readOfflineSnapshot(page, 'family')).toBeUndefined();
  await page.evaluate(() => {
    const estimate = navigator.storage.estimate.bind(navigator.storage);
    const { writeFromLegacyTab } = window as Window & { writeFromLegacyTab?: () => Promise<void> };
    navigator.storage.estimate = async () => {
      navigator.storage.estimate = estimate;
      await writeFromLegacyTab!();
      return estimate();
    };
  });
  await confirm.click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Dane starej karty zmieniły się podczas importu' }),
  ).toBeVisible();
  expect(await readOfflineSnapshot(page, 'family')).toBeUndefined();
  expect(await readOfflineSnapshot(page, 'shopping')).toBeUndefined();
  const expectedSources = { ...legacySources, [familyKey]: updatedFamily };
  expect(
    await page.evaluate((keys) => keys.map((key) => localStorage.getItem(key)), Object.keys(expectedSources)),
  ).toEqual(Object.values(expectedSources));

  await legacyTab.close();
  await confirm.click();
  await expect(page.getByText('TEST-NEW', { exact: true })).toBeVisible();
  await page.goto('/zakupy');
  await expect(page.getByRole('status').filter({ hasText: 'Jesteś offline' })).toBeVisible();
  type ShoppingQueue = { operations: { operationId: string }[] };
  const shopping = await readOfflineSnapshot<ShoppingQueue>(page, 'shopping');
  expect(shopping?.operations.map(({ operationId }) => operationId).sort()).toEqual([
    fixture.ids.bread,
    fixture.ids.shoppingEdit,
  ]);
  await page.close();

  const reopened = await context.newPage();
  await reopened.goto('/zakupy');
  await expect(reopened.getByRole('status').filter({ hasText: 'Jesteś offline' })).toBeVisible();
  expect((await readOfflineSnapshot<ShoppingQueue>(reopened, 'shopping'))?.operations).toEqual(shopping?.operations);
  expect(
    await reopened.evaluate(
      (keys) => keys.every((key) => localStorage.getItem(key) === null),
      Object.keys(legacySources),
    ),
  ).toBe(true);
});

for (const native of [false, true]) {
  test(`restores the migrated session without family or shopping cache through ${native ? 'Android transport' : 'WWW'}`, async ({
    page,
  }) => {
    if (native) await installNativeTransport(page);
    await page.addInitScript((entries) => {
      if (!localStorage.getItem('test:seeded')) {
        for (const entry of entries) localStorage.setItem(entry.key, JSON.stringify(entry.value));
        localStorage.setItem('test:seeded', 'yes');
      }
      localStorage.setItem('test:offline', 'yes');
    }, fixture.entries);
    await page.route('**/api/**', (route) => route.abort('internetdisconnected'));
    await page.goto('/wiecej/rodzina');
    await page.getByRole('button', { name: 'Potwierdzam zamknięcie starych kart — przenieś dane' }).click();
    await expect(page.getByText('TEST-CODE', { exact: true })).toBeVisible();
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('rodzina-offline', 3);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('cache', 'readwrite');
          const store = tx.objectStore('cache');
          const request = store.openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            if (['family', 'shopping'].includes(cursor.value.module)) cursor.delete();
            cursor.continue();
          };
          tx.oncomplete = () => resolve();
          tx.onerror = tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Rodzina', exact: true })).toBeVisible();
    await expect(page.getByText(/Brak danych rodziny zapisanych/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zaloguj się', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('migrates all legacy modules only after confirmation and restores them after an offline restart', async ({
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
  await page.goto('/kontakty');
  await expect(page.getByText(/Ostatnie udane pobranie:/)).toBeVisible();
  const contacts = await readOfflineSnapshot<{ data: { contacts: unknown[] } }>(page, 'contacts');
  expect(contacts?.data.contacts).toHaveLength(1);
  await page.screenshot({ path: info.outputPath('migrated-contacts-offline.png'), fullPage: true });
  await page.goto('/zadania');
  const tasks = await readOfflineSnapshot<{ snapshot: { lists: { id: string }[] }; operations: unknown[] }>(
    page,
    'tasks',
  );
  await expect
    .poll(async () => (await readOfflineSnapshot<{ operations: unknown[] }>(page, 'tasks'))?.operations.length)
    .toBe(1);
  await page.goto(`/zadania/${tasks!.snapshot.lists[0]!.id}`);
  await expect(page.getByRole('alert').filter({ hasText: 'Jesteś offline' })).toContainText('Ostatnie udane pobranie:');
  await page.screenshot({ path: info.outputPath('migrated-tasks-offline.png'), fullPage: true });
  await page.goto('/zakupy');
  await expect(page.getByRole('status').filter({ hasText: 'Jesteś offline' })).toContainText(
    'Ostatnie udane pobranie:',
  );
  expect((await readOfflineSnapshot<{ operations: unknown[] }>(page, 'shopping'))?.operations).toHaveLength(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('migrated-shopping-offline.png'), fullPage: true });
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) =>
        /^rodzina:(offline-data|calendar|contacts|shopping|tasks):v1/.test(key),
      ),
    ),
  ).toEqual([]);
});

test('shows a storage denial while keeping the online family view usable', async ({ page, baseURL }, info) => {
  const email = `idb-denied-${info.project.name}@example.com`;
  expect(
    (
      await page.request.post('/api/test/families', {
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
