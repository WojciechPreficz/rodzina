/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<unknown> };

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

function notificationUrl(value: unknown): string {
  if (typeof value === 'string') {
    try {
      const url = new URL(value, self.location.origin);
      if (url.origin === self.location.origin) return url.href;
    } catch {
      /* Fall back to the calendar for malformed URLs. */
    }
  }
  return new URL('/kalendarz', self.location.origin).href;
}

self.addEventListener('push', (event) => {
  let payload: Record<string, unknown> = {};
  try {
    const data: unknown = event.data?.json();
    if (typeof data === 'object' && data !== null) payload = data as Record<string, unknown>;
  } catch {
    /* DevTools can send a plain text test message. */
  }
  event.waitUntil(
    self.registration.showNotification(typeof payload.title === 'string' ? payload.title : 'Rodzina', {
      body: typeof payload.body === 'string' ? payload.body : 'Masz nowe powiadomienie.',
      tag: typeof payload.tag === 'string' ? payload.tag : 'rodzina',
      // Each manual test should alert again while replacing the previous test.
      ...(payload.tag === 'rodzina-push-test' ? { renotify: true } : {}),
      data: { url: notificationUrl(payload.url) },
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = notificationUrl(event.notification.data?.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing =
        windows.find((client) => client.url === url) ??
        windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) {
        const target = existing.url === url ? existing : await existing.navigate(url);
        if (target) {
          await target.focus();
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
