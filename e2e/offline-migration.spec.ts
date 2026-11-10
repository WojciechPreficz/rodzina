import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { installNativeTransport } from './nativeTransport.js';
import { offlineDatabaseName, readOfflineSnapshot } from './offlineDatabase.js';
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
  await expect(confirm).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Otwórz odzyskiwanie danych offline' })).toBeVisible();
  expect(await readOfflineSnapshot(page, 'family')).toBeUndefined();
  await page.getByRole('link', { name: 'Otwórz odzyskiwanie danych offline' }).click();
  await expect(confirm).toBeVisible();
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
    await page.getByRole('link', { name: 'Otwórz odzyskiwanie danych offline' }).click();
    await page.getByRole('button', { name: 'Potwierdzam zamknięcie starych kart — przenieś dane' }).click();
    await expect(page.getByText('TEST-CODE', { exact: true })).toBeVisible();
    await page.evaluate(
      async (name) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(name!);
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
      },
      await offlineDatabaseName(page),
    );
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Rodzina', exact: true })).toBeVisible();
    await expect(page.getByText(/Brak danych rodziny zapisanych/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zaloguj się', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('recovers all legacy modules only after opening recovery and confirming and restores them after an offline restart', async ({
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
  await expect(confirm).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Otwórz odzyskiwanie danych offline' })).toBeVisible();
  expect(await readOfflineSnapshot(page, 'family')).toBeUndefined();
  expect(await page.evaluate(() => localStorage.getItem('rodzina:offline-data:v1'))).not.toBeNull();
  await page.getByRole('link', { name: 'Otwórz odzyskiwanie danych offline' }).click();
  await expect(confirm).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
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

test('replays a pre-upgrade IndexedDB shopping journal after an offline restart', async ({
  page,
  context,
  baseURL,
}, info) => {
  const headers = { Origin: baseURL! };
  const registration = await page.request.post('/api/test/families', {
    headers,
    data: {
      familyName: 'Aktualizacja pamięci',
      displayName: 'Ania',
      email: `pre-upgrade-${info.project.name}@example.com`,
      password: 'password123',
    },
  });
  expect(registration.ok()).toBe(true);
  const { lists } = await (await page.request.get('/api/shopping/lists')).json();
  const listId = lists[0].id as string;
  const operationId = randomUUID();
  await page.goto('/zakupy');
  if (info.project.name === 'phone') await page.getByRole('button', { name: 'Zakupy', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Dodaj produkt' })).toBeEnabled();
  const accountDbName = (await offlineDatabaseName(page))!;

  // Close the running app before replacing the cache with a pre-upgrade snapshot and its embedded journal.
  await page.route('**/before-upgrade', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<title>Previous build storage fixture</title>' }),
  );
  await page.goto('/before-upgrade');
  await page.evaluate(
    async ({ listId, operationId, accountDbName }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(accountDbName);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(['cache', 'metadata'], 'readwrite');
          const cache = tx.objectStore('cache');
          const read = cache.getAll();
          read.onsuccess = () => {
            const record = read.result.find((entry) => entry.module === 'shopping');
            if (!record) return tx.abort();
            const { ranges, ...saved } = record.payload;
            const prefix = ['shopping', ...saved.account.split(':')];
            const queries = ranges.map(
              (range: { kind: 'lists' | 'items'; listId?: string; data: unknown; syncedAt: number }) => ({
                queryKey: range.kind === 'lists' ? [...prefix, 'lists'] : [...prefix, 'items', range.listId],
                state: { data: range.data, dataUpdatedAt: range.syncedAt },
              }),
            );
            cache.put({
              ...record,
              payload: {
                ...saved,
                version: 1,
                queries,
                operations: [
                  {
                    operationId,
                    submittedAt: Date.now(),
                    sequence: 1,
                    change: { type: 'add', id: operationId, listId, data: { name: 'Ryż sprzed aktualizacji' } },
                  },
                ],
                nextSequence: 2,
              },
            });
            tx.objectStore('metadata').put({
              accountId: saved.account,
              key: 'engine:shopping',
              value: 'legacy-idb',
            });
          };
          tx.oncomplete = () => resolve();
          tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Could not seed the pre-upgrade journal'));
        });
      } finally {
        db.close();
      }
      const keyPaths = {
        cache: ['accountId', 'module', 'key'],
        metadata: ['accountId', 'key'],
        outbox: ['accountId', 'operationId'],
        migration: ['accountId', 'module', 'importId'],
      };
      const names = Object.keys(keyPaths) as (keyof typeof keyPaths)[];
      const copied = await new Promise<unknown[][]>((resolve, reject) => {
        const request = indexedDB.open(accountDbName);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(names);
          const reads = names.map((name) => tx.objectStore(name).getAll());
          tx.oncomplete = () => resolve(reads.map((read) => read.result));
          tx.onabort = () => reject(tx.error);
          db.close();
        };
      });
      for (const name of ['rodzina-offline', accountDbName]) {
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
          request.onblocked = () => reject(new Error('Fixture database still open'));
        });
      }
      const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('rodzina-offline', 3);
        request.onupgradeneeded = () => {
          for (const [i, name] of names.entries()) {
            const store = request.result.createObjectStore(name, { keyPath: keyPaths[name] });
            for (const record of copied[i]!) store.add(record);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      // This simulates a tab that has not yet reacted to versionchange.
      legacy.onversionchange = () => (document.title = 'Legacy connection blocking the upgrade');
      localStorage.setItem('test:offline', 'yes');
    },
    { listId, operationId, accountDbName },
  );

  // Assets remain reachable, as in an APK cold start. Only API access is unavailable.
  const reopened = await context.newPage();
  await installNativeTransport(reopened);
  await reopened.route('**/api/**', (route) => route.abort('internetdisconnected'));
  await reopened.goto('/zakupy');
  await expect(page).toHaveTitle('Legacy connection blocking the upgrade');
  await expect(reopened.getByRole('alert').filter({ hasText: 'Aktualizacja pamięci jest zablokowana' })).toBeVisible();
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([{ name: 'rodzina-offline', version: 3 }]);
  await page.close();
  await reopened.goto('/zakupy');
  if (info.project.name === 'phone') await reopened.getByRole('button', { name: 'Zakupy', exact: true }).click();
  await expect(reopened.getByRole('article', { name: 'Ryż sprzed aktualizacji', exact: true })).toBeVisible();
  await expect(reopened.getByRole('heading', { name: 'Odzyskiwanie danych offline' })).toHaveCount(0);
  const shopping = await readOfflineSnapshot<{ version: number; operations: { operationId: string }[] }>(
    reopened,
    'shopping',
  );
  expect(shopping?.version).toBe(2);
  expect(shopping?.operations.map((operation) => operation.operationId)).toEqual([operationId]);
  await reopened.reload();
  await expect(reopened.getByRole('article', { name: 'Ryż sprzed aktualizacji', exact: true })).toBeVisible();
  expect(await reopened.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await reopened.screenshot({ path: info.outputPath('pre-upgrade-journal-offline.png'), fullPage: true });

  await reopened.unroute('**/api/**');
  const mutation = reopened.waitForRequest(
    (request) => request.method() === 'POST' && new URL(request.url()).searchParams.get('operationId') === operationId,
  );
  await reopened.evaluate(() => {
    localStorage.removeItem('test:offline');
    window.dispatchEvent(new Event('online'));
  });
  await mutation;
  await expect
    .poll(async () => (await readOfflineSnapshot<{ operations: unknown[] }>(reopened, 'shopping'))?.operations)
    .toEqual([]);
  const { items } = await (await reopened.request.get(`/api/shopping/lists/${listId}/items`)).json();
  expect(items.map((item: { id: string; name: string }) => [item.id, item.name])).toEqual([
    [operationId, 'Ryż sprzed aktualizacji'],
  ]);
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
