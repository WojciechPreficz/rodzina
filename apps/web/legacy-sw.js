/* global self, caches */
// Retirement endpoint for existing installations. New visitors never register it.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      try {
        const subscription = await self.registration.pushManager.getSubscription();
        if (subscription) await subscription.unsubscribe();
      } catch {
        // Unregister even when the push provider is unavailable.
      }
      try {
        const names = await caches.keys();
        await Promise.all(
          names
            .filter((name) => name.startsWith('workbox-precache-') && name.endsWith(`-${self.registration.scope}`))
            .map((name) => caches.delete(name)),
        );
      } finally {
        await self.registration.unregister();
      }
    })(),
  );
});
