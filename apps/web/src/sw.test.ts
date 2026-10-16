// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('workbox-core', () => ({ clientsClaim: vi.fn() }));
vi.mock('workbox-precaching', () => ({ cleanupOutdatedCaches: vi.fn(), precacheAndRoute: vi.fn() }));

describe('push service worker', () => {
  const handlers = new Map<string, (event: unknown) => void>();
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const matchAll = vi.fn().mockResolvedValue([]);
  const openWindow = vi.fn().mockResolvedValue(undefined);
  async function dispatch(type: string, data: Record<string, unknown>) {
    let pending: Promise<unknown> | undefined;
    handlers.get(type)!({
      ...data,
      waitUntil: (promise: Promise<unknown>) => {
        pending = promise;
      },
    });
    await pending;
  }
  beforeEach(async () => {
    vi.resetModules();
    showNotification.mockClear();
    matchAll.mockReset().mockResolvedValue([]);
    openWindow.mockClear();
    vi.stubGlobal('self', {
      __WB_MANIFEST: [],
      skipWaiting: vi.fn(),
      location: { origin: 'http://localhost:3000' },
      registration: { showNotification },
      clients: { matchAll, openWindow },
      addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
    });
    await import('./sw.js');
  });
  afterEach(() => vi.unstubAllGlobals());
  it('shows payload title, body, tag, deep link and icons', async () => {
    await dispatch('push', {
      data: {
        json: () => ({
          title: 'Jutro: Basen',
          body: 'Zosia',
          tag: 'event:date',
          url: '/kalendarz/wydarzenie/123?data=2026-10-20',
        }),
      },
    });
    expect(showNotification).toHaveBeenCalledWith('Jutro: Basen', {
      body: 'Zosia',
      tag: 'event:date',
      data: { url: 'http://localhost:3000/kalendarz/wydarzenie/123?data=2026-10-20' },
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    });
  });
  it.each([
    undefined,
    {
      json: () => {
        throw new Error('plain DevTools text');
      },
    },
    { json: () => null },
  ])('handles empty or malformed DevTools pushes', async (data) => {
    await dispatch('push', { data });
    expect(showNotification).toHaveBeenCalledWith(
      'Rodzina',
      expect.objectContaining({ data: { url: 'http://localhost:3000/kalendarz' } }),
    );
  });
  it('navigates an existing window to the occurrence and focuses it', async () => {
    const focus = vi.fn();
    const navigate = vi.fn().mockResolvedValue({ focus });
    const close = vi.fn();
    matchAll.mockResolvedValue([{ url: 'http://localhost:3000/kalendarz', navigate, focus }]);
    await dispatch('notificationclick', {
      notification: { close, data: { url: '/kalendarz/wydarzenie/123?data=2026-10-20' } },
    });
    expect(close).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('http://localhost:3000/kalendarz/wydarzenie/123?data=2026-10-20');
    expect(focus).toHaveBeenCalledOnce();
    expect(openWindow).not.toHaveBeenCalled();
  });
  it('prefers a window already displaying the target', async () => {
    const focus = vi.fn();
    const navigate = vi.fn();
    matchAll.mockResolvedValue([
      { url: 'http://localhost:3000/', focus: vi.fn() },
      { url: 'http://localhost:3000/kalendarz', navigate, focus },
    ]);
    await dispatch('notificationclick', { notification: { close: vi.fn(), data: { url: '/kalendarz' } } });
    expect(focus).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
  });
  it('opens a window when the app is closed', async () => {
    await dispatch('notificationclick', {
      notification: { close: vi.fn(), data: { url: '/kalendarz/wydarzenie/123' } },
    });
    expect(openWindow).toHaveBeenCalledWith('http://localhost:3000/kalendarz/wydarzenie/123');
  });
  it.each(['https://foreign.example/path', 'javascript:alert(1)', '//foreign.example/path'])(
    'replaces external notification URLs with the calendar',
    async (url) => {
      await dispatch('push', { data: { json: () => ({ url }) } });
      expect(showNotification).toHaveBeenCalledWith(
        'Rodzina',
        expect.objectContaining({ data: { url: 'http://localhost:3000/kalendarz' } }),
      );
      await dispatch('notificationclick', { notification: { close: vi.fn(), data: { url } } });
      expect(openWindow).toHaveBeenCalledWith('http://localhost:3000/kalendarz');
    },
  );
});
