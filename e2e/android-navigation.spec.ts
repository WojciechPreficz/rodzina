import { expect, test } from '@playwright/test';
import { openNavigation } from './navigation.js';

test('Android cold notification opens a stored occurrence offline and warm App Links reach auth screens', async ({
  page,
}, testInfo) => {
  const eventId = '10000000-0000-4000-8000-000000000002';
  const url = `/kalendarz/wydarzenie/${eventId}?data=2026-10-20`;
  await page.addInitScript(
    ({ url, eventId }) => {
      const callbacks = new Map<string, (data: unknown) => void>();
      const snapshot = {
        ok: true,
        generatedAt: 0,
        validUntil: 9999999999999,
        reminders: [
          {
            key: 'saved',
            reminderId: '10000000-0000-4000-8000-000000000001',
            sourceType: 'event',
            sourceId: eventId,
            occurrenceDate: '2026-10-20',
            fireAt: 1,
            title: 'Basen offline',
            body: '20.10.2026, 17:00 · Zosia',
            url,
          },
        ],
      };
      const methods = {
        RodzinaApi: ['request', 'clearSession'],
        RodzinaAlarms: ['preview'],
        App: ['getLaunchUrl', 'minimizeApp'],
        LocalNotifications: [],
      };
      Object.assign(window, {
        emitNativeLink: (url: string) => callbacks.get('App:appUrlOpen')?.({ url }),
        CapacitorCustomPlatform: { name: 'android' },
        Capacitor: {
          PluginHeaders: Object.entries(methods).map(([name, names]) => ({
            name,
            methods: [
              ...names.map((name) => ({ name, rtype: 'promise' })),
              { name: 'addListener', rtype: 'callback' },
              { name: 'removeListener', rtype: 'promise' },
            ],
          })),
          nativeCallback: (
            plugin: string,
            _method: string,
            options: { eventName: string },
            callback: (data: unknown) => void,
          ) => {
            callbacks.set(`${plugin}:${options.eventName}`, callback);
            if (options.eventName === 'localNotificationActionPerformed')
              queueMicrotask(() => callback({ notification: { extra: { url } } }));
            return `${plugin}:${options.eventName}`;
          },
          nativePromise: async (plugin: string, method: string, options: { path: string }) => {
            if (plugin === 'RodzinaApi' && method === 'request') {
              if (options.path === '/api/auth/me') throw new Error('Brak połączenia');
              return { status: 404, body: JSON.stringify({ error: { message: 'Link jest nieważny.' } }) };
            }
            if (plugin === 'RodzinaAlarms') return { value: JSON.stringify({ snapshot }) };
            return {};
          },
        },
      });
    },
    { url, eventId },
  );
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`data=2026-10-20$`));
  await expect(page.getByRole('heading', { name: 'Basen offline' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('może być nieaktualny');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('offline-occurrence.png'), fullPage: true });
  const emit = (url: string) =>
    page.evaluate((url) => (window as unknown as { emitNativeLink: (url: string) => void }).emitNativeLink(url), url);
  await emit('https://evil.test/zaproszenie/token');
  await expect(page).toHaveURL(new RegExp('data=2026-10-20$'));
  await emit('https://rodzina.preficze.pl/reset-hasla/token');
  await expect(page).toHaveURL(/\/reset-hasla\/token$/);
  await expect(page.getByRole('heading', { name: 'Ustaw nowe hasło', exact: true })).toBeVisible();
  await emit('https://rodzina.preficze.pl/zaproszenie/token');
  await expect(page).toHaveURL(/\/zaproszenie\/token$/);
  await expect(page.getByRole('alert')).toContainText('Link jest nieważny');
});

test('calendar form survives rejecting discard on modal close and browser navigation', async ({
  page,
  baseURL,
}, testInfo) => {
  const registered = await page.request.post('/api/auth/register-family', {
    headers: { Origin: baseURL! },
    data: {
      familyName: 'Nawigacja',
      displayName: 'Anna',
      email: `nav-${testInfo.project.name}@example.com`,
      password: 'password123',
    },
  });
  expect(registered.ok()).toBe(true);
  await page.goto('/wiecej');
  await openNavigation(page);
  await page.getByRole('link', { name: 'Kalendarz', exact: true }).click();
  await page.getByRole('button', { name: 'Dodaj wydarzenie', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Jednorazowe', exact: true }).click();
  await dialog.getByLabel(/^Tytuł/).fill('Niezapisany formularz');
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await dialog.getByRole('button', { name: 'Anuluj', exact: true }).click();
  await expect(dialog.getByLabel(/^Tytuł/)).toHaveValue('Niezapisany formularz');
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(/\/kalendarz$/);
  await expect(dialog.getByLabel(/^Tytuł/)).toHaveValue('Niezapisany formularz');
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  page.once('dialog', (confirmation) => confirmation.accept());
  await dialog.getByRole('button', { name: 'Anuluj', exact: true }).click();
  await expect(dialog.getByLabel(/^Tytuł/)).not.toBeVisible();
});
