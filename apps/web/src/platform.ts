import { Capacitor, registerPlugin } from '@capacitor/core';
import { assertSessionCurrent } from './sessionRequests.js';

export { getSessionGeneration, invalidateSessionRequests } from './sessionRequests.js';

export const isAndroid = () => Capacitor.getPlatform() === 'android';

export const nativeApi = registerPlugin<{
  request(options: { path: string; method: string; body?: string }): Promise<{ status: number; body: string }>;
  clearSession(): Promise<void>;
}>('RodzinaApi');

export async function clearNativeSession(current = () => true) {
  if (isAndroid()) {
    const { localScheduler } = await import('./reminders/localSchedule.js');
    if (!current()) return;
    try {
      await localScheduler.clear();
    } finally {
      if (current()) await nativeApi.clearSession();
    }
  }
}

export async function nativeRequest(input: string, init: RequestInit, generation: number) {
  const assertCurrent = () => {
    assertSessionCurrent(generation);
    init.signal?.throwIfAborted();
  };
  const url = new URL(input, 'https://localhost');
  if (url.origin !== 'https://localhost' || !url.pathname.startsWith('/api/')) {
    throw new Error('Invalid API path.');
  }
  if (init.body != null && typeof init.body !== 'string') throw new Error('Native API requires JSON.');
  assertCurrent();
  if (
    ['/api/auth/login', '/api/auth/login-child', '/api/auth/register-family'].includes(url.pathname) ||
    /^\/api\/invitations\/[^/]+\/accept$/.test(url.pathname)
  ) {
    const { localScheduler } = await import('./reminders/localSchedule.js');
    assertCurrent();
    await localScheduler.clear();
    assertCurrent();
  }
  const result = await nativeApi.request({
    path: url.pathname + url.search,
    method: init.method ?? 'GET',
    ...(typeof init.body === 'string' ? { body: init.body } : {}),
  });
  assertCurrent();
  if (result.status === 401 || (result.status === 403 && url.pathname === '/api/reminders/schedule')) {
    const { localScheduler } = await import('./reminders/localSchedule.js');
    assertCurrent();
    // Do not await: this request can itself be inside the scheduler queue.
    void localScheduler.clear().catch(() => undefined);
  }
  return {
    ok: result.status >= 200 && result.status < 300,
    status: result.status,
    headers: new Headers(),
    text: async () => result.body,
  };
}
