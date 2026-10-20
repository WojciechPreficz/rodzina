import type { Page } from '@playwright/test';

export async function installNativeTransport(page: Page) {
  await page.addInitScript(() => {
    const methods = {
      RodzinaApi: ['request', 'clearSession'],
      Network: ['getStatus', 'addListener', 'removeListener'],
      App: ['getState', 'addListener', 'removeListener'],
      RodzinaAlarms: ['read', 'write', 'runtimeStatus'],
      LocalNotifications: ['checkPermissions', 'checkExactNotificationSetting', 'getAll'],
    };
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => localStorage.getItem('test:offline') !== 'yes',
    });
    Object.assign(window, {
      CapacitorCustomPlatform: { name: 'android' },
      Capacitor: {
        PluginHeaders: Object.entries(methods).map(([name, names]) => ({
          name,
          methods: names.map((name) => ({ name, rtype: name === 'addListener' ? 'callback' : 'promise' })),
        })),
        nativeCallback: () => 'test-listener',
        nativePromise: async (
          plugin: string,
          method: string,
          options: { path: string; method: string; body?: string },
        ) => {
          if (plugin === 'Network' && method === 'getStatus')
            return { connected: navigator.onLine, connectionType: 'wifi' };
          if (plugin === 'App' && method === 'getState') return { isActive: true };
          if (plugin === 'RodzinaApi' && method === 'request') {
            const response = await fetch(options.path, {
              method: options.method,
              credentials: 'include',
              ...(options.body ? { body: options.body, headers: { 'Content-Type': 'application/json' } } : {}),
            });
            return { status: response.status, body: await response.text() };
          }
          if (method === 'read') return { value: null, revision: 'test' };
          if (method === 'runtimeStatus') return { backgroundRestricted: false };
          if (method === 'checkPermissions') return { display: 'denied' };
          if (method === 'checkExactNotificationSetting') return { exact_alarm: 'denied' };
          return { notifications: [] };
        },
      },
    });
  });
}
