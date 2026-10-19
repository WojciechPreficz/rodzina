// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';

it.each([false, true])('retires an existing worker even if push is unavailable=%s', async (failPush) => {
  const handlers = new Map<string, (event: { waitUntil: (pending: Promise<unknown>) => void }) => void>();
  const scope = 'https://rodzina.preficze.pl/';
  const unregister = vi.fn().mockResolvedValue(true);
  const unsubscribe = vi.fn().mockImplementation(async () => {
    if (failPush) throw new Error('push unavailable');
    return true;
  });
  const claim = vi.fn().mockResolvedValue(undefined);
  const skipWaiting = vi.fn().mockResolvedValue(undefined);
  const remove = vi.fn().mockResolvedValue(true);
  runInNewContext(readFileSync(new URL('../legacy-sw.js', import.meta.url), 'utf8'), {
    self: {
      addEventListener: (type: string, handler: (event: { waitUntil: (pending: Promise<unknown>) => void }) => void) =>
        handlers.set(type, handler),
      skipWaiting,
      clients: { claim },
      registration: { scope, unregister, pushManager: { getSubscription: async () => ({ unsubscribe }) } },
    },
    caches: {
      keys: async () => [`workbox-precache-v2-${scope}`, `workbox-precache-v2-${scope}other/`, 'family-data'],
      delete: remove,
    },
  });
  for (const type of ['install', 'activate']) {
    let pending: Promise<unknown> | undefined;
    handlers.get(type)!({ waitUntil: (value) => (pending = value) });
    await pending;
  }
  expect(skipWaiting).toHaveBeenCalledOnce();
  expect(claim).toHaveBeenCalledOnce();
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(unregister).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledExactlyOnceWith(`workbox-precache-v2-${scope}`);
  expect([...handlers.keys()]).toEqual(['install', 'activate']);
});
