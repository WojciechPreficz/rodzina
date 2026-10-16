import { expect, test } from '@playwright/test';

test('manual Android alarm screen fits the viewport with a mocked native bridge', async ({
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
  await page.addInitScript(() => {
    let saved: string | null = null;
    const pending = new Map<number, Record<string, unknown>>();
    const methods = {
      RodzinaApi: ['request', 'clearSession'],
      RodzinaAlarms: ['read', 'write'],
      LocalNotifications: [
        'checkPermissions',
        'checkExactNotificationSetting',
        'listChannels',
        'createChannel',
        'getPending',
        'schedule',
        'cancel',
        'removeAllDeliveredNotifications',
        'requestPermissions',
        'changeExactNotificationSetting',
      ],
    };
    Object.assign(window, {
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
            if (method === 'read') return { value: saved, revision: 'test' };
            saved = options.value as string;
            return {};
          }
          if (method === 'checkPermissions') return { display: 'granted' };
          if (method === 'checkExactNotificationSetting') return { exact_alarm: 'granted' };
          if (method === 'listChannels') return { channels: [] };
          if (method === 'getPending') return { notifications: [...pending.values()] };
          if (method === 'schedule') {
            for (const item of options.notifications as { id: number }[]) pending.set(item.id, item);
          }
          return {};
        },
      },
    });
  });
  await page.goto('/wiecej/powiadomienia');
  await expect(page.getByRole('heading', { name: 'Przypomnienia offline' })).toBeVisible();
  await expect(page.getByText('Dokładne alarmy: dozwolone')).toBeVisible();
  await page.getByRole('button', { name: 'Pobierz i zapisz harmonogram' }).click();
  await expect(page.getByRole('status')).toContainText('Harmonogram zapisany.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('local-alarms.png'), fullPage: true });
});
