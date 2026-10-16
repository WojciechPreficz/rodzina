import { afterEach, describe, expect, it, vi } from 'vitest';
const { request, clearSession, getPlatform } = vi.hoisted(() => ({
  request: vi.fn(),
  clearSession: vi.fn(),
  getPlatform: vi.fn(() => 'android'),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform },
  registerPlugin: () => ({ request, clearSession }),
}));
import { apiFetch, ApiRequestError } from './api.js';
import { clearNativeSession, invalidateSessionRequests } from './platform.js';
import { supportsPush } from './features/notifications/pushClient.js';
vi.mock('./features/notifications/localSchedule.js', () => ({
  localScheduler: { clear: vi.fn(async () => undefined) },
}));

afterEach(() => {
  vi.clearAllMocks();
  getPlatform.mockReturnValue('android');
  vi.unstubAllGlobals();
});

describe('Android API transport', () => {
  it('uses the native bridge for adult and child login and calendar writes without exposing cookies', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    request.mockResolvedValue({ status: 200, body: '{"ok":true}' });
    for (const path of ['/api/auth/login', '/api/auth/login-child', '/api/events']) {
      await expect(apiFetch(path, { method: 'POST', body: '{"title":"Basen"}' })).resolves.toEqual({ ok: true });
      expect(request).toHaveBeenLastCalledWith({ path, method: 'POST', body: '{"title":"Basen"}' });
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(supportsPush()).toBe(false);
  });

  it('keeps browser fetch credentials and does not use the bridge for PWA', async () => {
    getPlatform.mockReturnValue('web');
    const fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '{"ok":true}' });
    vi.stubGlobal('fetch', fetch);
    await apiFetch('/api/auth/me');
    expect(fetch).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({ credentials: 'include' }));
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects external and normalized escape paths before sending credentials', async () => {
    for (const path of ['https://evil.example/api/events', '//evil.example/api/events', '/api/../../events']) {
      await expect(apiFetch(path)).rejects.toThrow('Invalid API path');
    }
    expect(request).not.toHaveBeenCalled();
  });

  it('discards a response started before an account change', async () => {
    let finish!: (value: { status: number; body: string }) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = apiFetch('/api/events');
    invalidateSessionRequests();
    finish({ status: 200, body: '{"title":"Previous account"}' });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await clearNativeSession();
    expect(clearSession).toHaveBeenCalledOnce();
  });

  it('signals loss of session only for 401, preserving the session on network errors and forbidden edits', async () => {
    const listener = vi.fn();
    window.addEventListener('rodzina:session-lost', listener);
    try {
      request.mockRejectedValueOnce(new Error('offline'));
      await expect(apiFetch('/api/events')).rejects.toThrow('offline');
      request.mockResolvedValueOnce({ status: 403, body: '{"error":{"message":"Brak uprawnień"}}' });
      await expect(apiFetch('/api/events')).rejects.toBeInstanceOf(ApiRequestError);
      expect(listener).not.toHaveBeenCalled();
      request.mockResolvedValueOnce({ status: 401, body: '{}' });
      await expect(apiFetch('/api/auth/me')).rejects.toMatchObject({ status: 401 });
      expect(listener).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener('rodzina:session-lost', listener);
    }
  });
});
