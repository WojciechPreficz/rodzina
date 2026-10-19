import { expect, test } from '@playwright/test';

test('Android schedule sync screen fits the viewport with a mocked native bridge', async ({
  page,
  baseURL,
}, testInfo) => {
  const registered = await page.request.post('/api/auth/register-family', {
    headers: { Origin: baseURL! },
    data: {
      familyName: 'Alarmy',
      displayName: 'Anna',
      email: `alarms-${testInfo.project.name}@example.com`,
      password: 'password123',
    },
  });
  expect(registered.ok()).toBe(true);
  const created = await page.request.post('/api/events', {
    headers: { Origin: baseURL! },
    data: {
      title: 'Pierwotny termin',
      description: null,
      location: null,
      startDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
      startTime: '17:00',
      durationMinutes: 60,
      datePrecision: 'day',
      rrule: null,
      kind: 'single',
      participantIds: [],
      reminders: [{ type: 'offset', offsetValue: 0, offsetUnit: 'minute', audience: 'family' }],
    },
  });
  expect(created.ok()).toBe(true);
  const { event } = await created.json();
  await page.addInitScript(() => {
    let saved: string | null = null;
    const pending = new Map<number, Record<string, unknown>>();
    const methods = {
      RodzinaApi: ['request', 'clearSession'],
      RodzinaAlarms: ['read', 'write', 'runtimeStatus', 'openAppSettings'],
      LocalNotifications: [
        'checkPermissions',
        'checkExactNotificationSetting',
        'listChannels',
        'createChannel',
        'getAll',
        'schedule',
        'cancel',
        'removeAllDeliveredNotifications',
        'requestPermissions',
        'changeExactNotificationSetting',
      ],
    };
    Object.assign(window, {
      readTestAlarms: () => [...pending.values()],
      CapacitorCustomPlatform: { name: 'android' },
      Capacitor: {
        PluginHeaders: Object.entries(methods).map(([name, names]) => ({
          name,
          methods: names.map((name) => ({ name, rtype: 'promise' })),
        })),
        nativePromise: async (plugin: string, method: string, options: Record<string, unknown>) => {
          if (plugin === 'RodzinaApi' && method === 'request') {
            const response = await fetch(options.path as string, { credentials: 'include' });
            return { status: response.status, body: await response.text() };
          }
          if (plugin === 'RodzinaAlarms') {
            if (method === 'runtimeStatus') return { backgroundRestricted: false, manufacturer: 'OPPO' };
            if (method === 'openAppSettings') return {};
            if (method === 'read') return { value: saved, revision: 'test' };
            saved = options.value as string;
            return {};
          }
          if (method === 'checkPermissions') return { display: 'granted' };
          if (method === 'checkExactNotificationSetting') return { exact_alarm: 'granted' };
          if (method === 'listChannels') return { channels: [] };
          if (method === 'getAll') return { notifications: [...pending.values()] };
          if (method === 'schedule') {
            for (const item of options.notifications as { id: number }[]) pending.set(item.id, item);
          }
          if (method === 'cancel') {
            for (const item of options.notifications as { id: number }[]) pending.delete(item.id);
          }
          return {};
        },
      },
    });
  });
  await page.goto('/wiecej/powiadomienia');
  await expect(page.getByRole('heading', { name: 'Przypomnienia offline' })).toBeVisible();
  await expect(page.getByText('Dokładne alarmy: dozwolone')).toBeVisible();
  await page.getByRole('button', { name: 'Synchronizuj teraz' }).click();
  await expect(page.getByRole('status')).toContainText('Harmonogram zapisany.');
  await expect(page.getByRole('status')).toContainText('1 z 1');
  await expect(page.getByRole('status')).toContainText('Najbliższy zapisany alarm:');
  await expect(page.getByRole('button', { name: 'Powiadomienia dozwolone' })).toBeDisabled();
  await expect(page.getByText(/Na telefonach OPPO/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('local-alarms.png'), fullPage: true });
  const alarms = () =>
    page.evaluate(() =>
      (window as unknown as { readTestAlarms: () => { id: number; title: string }[] }).readTestAlarms(),
    );
  const original = await alarms();
  expect(original).toHaveLength(1);

  // The API request represents an edit from another device, outside this React client.
  const edited = await page.request.patch(`/api/events/${event.id}`, {
    headers: { Origin: baseURL! },
    data: { title: 'Zmieniony termin' },
  });
  expect(edited.ok()).toBe(true);
  await page.getByRole('button', { name: 'Synchronizuj teraz' }).click();
  await expect.poll(async () => (await alarms())[0]?.title).toContain('Zmieniony termin');
  expect((await alarms()).map((item) => item.id)).toEqual(original.map((item) => item.id));

  await page.route('**/api/reminders/schedule', (route) => route.abort());
  await page.getByRole('button', { name: 'Synchronizuj teraz' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(await alarms()).toHaveLength(1);
  await expect(page.getByRole('status')).not.toContainText('Harmonogram zapisany.');
  await page.unroute('**/api/reminders/schedule');

  const removed = await page.request.delete(`/api/events/${event.id}`, {
    headers: { Origin: baseURL!, 'Content-Type': 'application/json' },
    data: {},
  });
  expect(removed.ok()).toBe(true);
  await page.getByRole('button', { name: 'Synchronizuj teraz' }).click();
  await expect.poll(alarms).toHaveLength(0);
  await expect(page.getByRole('status')).toContainText('Harmonogram zapisany.');
});
