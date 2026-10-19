import { afterEach, expect, it, vi } from 'vitest';
import { retireLegacyPwa } from './retireLegacyPwa.js';

afterEach(() => vi.unstubAllGlobals());

it('keeps the old cache when its active worker cannot be updated yet', async () => {
  const scope = `${window.location.origin}/`;
  const unregister = vi.fn();
  const remove = vi.fn();
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistrations: async () => [
        {
          scope,
          active: { scriptURL: `${scope}sw.js` },
          update: async () => {
            throw new Error('offline');
          },
          unregister,
        },
      ],
    },
  });
  vi.stubGlobal('caches', { keys: vi.fn(), delete: remove });
  await expect(retireLegacyPwa()).rejects.toThrow('offline');
  expect(unregister).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

it.each([false, true])('removes only legacy PWA data even when push cleanup fails=%s', async (failPush) => {
  const scope = `${window.location.origin}/`;
  const unregister = vi.fn().mockResolvedValue(true);
  const unsubscribe = vi.fn().mockImplementation(async () => {
    if (failPush) throw new Error('push unavailable');
    return true;
  });
  const other = { scope: `${scope}other/`, active: { scriptURL: `${scope}other/sw.js` }, unregister: vi.fn() };
  const registration = {
    scope,
    active: { scriptURL: `${scope}sw.js` },
    update: vi.fn().mockResolvedValue(undefined),
    unregister,
    pushManager: { getSubscription: async () => ({ unsubscribe }) },
  };
  const remove = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: async () => [registration, other] } });
  vi.stubGlobal('caches', {
    keys: async () => [`workbox-precache-v2-${scope}`, `workbox-precache-v2-${scope}other/`, 'family-data'],
    delete: remove,
  });
  if (failPush) await expect(retireLegacyPwa()).rejects.toThrow('push unavailable');
  else await retireLegacyPwa();
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(unregister).toHaveBeenCalledOnce();
  expect(other.unregister).not.toHaveBeenCalled();
  if (!failPush) expect(remove).toHaveBeenCalledExactlyOnceWith(`workbox-precache-v2-${scope}`);
});
