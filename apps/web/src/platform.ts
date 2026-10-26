import { Capacitor, registerPlugin } from '@capacitor/core';

export const isAndroid = () => Capacitor.getPlatform() === 'android';
let sessionGeneration = 0;
export const getSessionGeneration = () => sessionGeneration;

export function invalidateSessionRequests() {
  sessionGeneration += 1;
}

export const nativeApi = registerPlugin<{
  request(options: { path: string; method: string; body?: string }): Promise<{ status: number; body: string }>;
  clearSession(): Promise<void>;
}>('RodzinaApi');

export async function clearNativeSession() {
  if (isAndroid()) {
    const { localScheduler } = await import('./features/notifications/localSchedule.js');
    try {
      await localScheduler.clear();
    } finally {
      await nativeApi.clearSession();
    }
  }
}

export async function nativeRequest(input: string, init: RequestInit) {
  const generation = sessionGeneration;
  const url = new URL(input, 'https://localhost');
  if (url.origin !== 'https://localhost' || !url.pathname.startsWith('/api/')) {
    throw new Error('Invalid API path.');
  }
  if (init.body != null && typeof init.body !== 'string') throw new Error('Native API requires JSON.');
  init.signal?.throwIfAborted();
  if (
    ['/api/auth/login', '/api/auth/login-child', '/api/auth/register-family'].includes(url.pathname) ||
    /^\/api\/invitations\/[^/]+\/accept$/.test(url.pathname)
  ) {
    const { localScheduler } = await import('./features/notifications/localSchedule.js');
    await localScheduler.clear();
  }
  const result = await nativeApi.request({
    path: url.pathname + url.search,
    method: init.method ?? 'GET',
    ...(typeof init.body === 'string' ? { body: init.body } : {}),
  });
  if (generation !== sessionGeneration) throw new DOMException('Session changed', 'AbortError');
  if (result.status === 401 || (result.status === 403 && url.pathname === '/api/reminders/schedule')) {
    const { localScheduler } = await import('./features/notifications/localSchedule.js');
    // Do not await: this request can itself be inside the scheduler queue.
    void localScheduler.clear().catch(() => undefined);
  }
  if (generation !== sessionGeneration) throw new DOMException('Session changed', 'AbortError');
  init.signal?.throwIfAborted();
  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    headers: new Headers(),
    text: async () => result.body,
  };
}
