/** Remove only Rodzina's legacy root worker and its Workbox precache. */
export async function retireLegacyPwa(): Promise<void> {
  const scope = new URL('/', window.location.origin).href;
  const workerUrl = new URL('/sw.js', scope).href;
  const registrations = await navigator.serviceWorker.getRegistrations();
  const removals = await Promise.allSettled(
    registrations
      .filter(
        (registration) =>
          registration.scope === scope &&
          [registration.active, registration.waiting, registration.installing].some(
            (worker) => worker?.scriptURL === workerUrl,
          ),
      )
      .map(async (registration) => {
        // Unregistering alone leaves the old worker controlling open tabs. Let
        // the retirement worker replace its fetch handler before clearing cache.
        const previous = registration.active;
        await registration.update();
        const replacement = registration.installing ?? registration.waiting;
        if (previous && navigator.serviceWorker.controller === previous) {
          if (!replacement) throw new Error('Legacy service worker has not been replaced yet.');
          await new Promise<void>((resolve, reject) => {
            const finish = () => {
              if (replacement.state !== 'activated' && replacement.state !== 'redundant') return;
              clearTimeout(timeout);
              replacement.removeEventListener('statechange', finish);
              if (replacement.state === 'activated') resolve();
              else reject(new Error('Legacy service worker update failed.'));
            };
            const timeout = setTimeout(() => {
              replacement.removeEventListener('statechange', finish);
              reject(new Error('Legacy service worker update timed out.'));
            }, 10000);
            replacement.addEventListener('statechange', finish);
            finish();
          });
        }
        try {
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) await subscription.unsubscribe();
        } finally {
          await registration.unregister();
        }
      }),
  );
  const failed = removals.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
  if ('caches' in window) {
    const names = await window.caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith('workbox-precache-') && name.endsWith(`-${scope}`))
        .map((name) => window.caches.delete(name)),
    );
  }
}
