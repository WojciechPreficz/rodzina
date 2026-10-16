import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiFetch } from '../../api.js';
import { enablePush, readPushStatus } from './pushClient.js';

vi.mock('../../api.js', () => ({ apiFetch: vi.fn() }));
const subscription = {
  endpoint: 'https://push.example/device',
  toJSON: () => ({ endpoint: 'https://push.example/device', keys: {} }),
  unsubscribe: vi.fn(),
};
const getSubscription = vi.fn();
const subscribe = vi.fn();
const requestPermission = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { permission: 'default', requestPermission });
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistration: vi.fn().mockResolvedValue({ active: {}, pushManager: { getSubscription, subscribe } }),
    },
  });
  getSubscription.mockResolvedValue(null);
  subscribe.mockResolvedValue(subscription);
  requestPermission.mockResolvedValue('granted');
  vi.mocked(apiFetch)
    .mockReset()
    .mockImplementation(async (url) => (url.endsWith('public-key') ? { ok: true, publicKey: 'AQID' } : { ok: true }));
});
afterEach(() => vi.unstubAllGlobals());
it('requests permission synchronously before fetching and saves the browser JSON', async () => {
  const pending = enablePush();
  expect(requestPermission).toHaveBeenCalledOnce();
  expect(apiFetch).not.toHaveBeenCalled();
  await pending;
  expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: new Uint8Array([1, 2, 3]) });
  expect(apiFetch).toHaveBeenCalledWith('/api/push/subscriptions', {
    method: 'POST',
    body: JSON.stringify(subscription.toJSON()),
  });
});
it('reads status without asking permission or subscribing', async () => {
  getSubscription.mockResolvedValue(subscription);
  vi.mocked(apiFetch).mockResolvedValue({ ok: true, subscribed: true, hasReminders: true });
  expect(await readPushStatus()).toMatchObject({ subscribed: true, hasReminders: true });
  expect(apiFetch).toHaveBeenCalledWith('/api/push/status', {
    method: 'POST',
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  expect(requestPermission).not.toHaveBeenCalled();
  expect(subscribe).not.toHaveBeenCalled();
});
it.each(['denied', 'default'])('does not subscribe after permission %s', async (permission) => {
  requestPermission.mockResolvedValue(permission);
  await expect(enablePush()).rejects.toThrow();
  expect(apiFetch).not.toHaveBeenCalled();
  expect(subscribe).not.toHaveBeenCalled();
});
it('reuses an existing subscription without subscribing again', async () => {
  getSubscription.mockResolvedValue(subscription);
  await enablePush();
  expect(subscribe).not.toHaveBeenCalled();
});
it('rolls back a newly created subscription when saving fails', async () => {
  vi.mocked(apiFetch)
    .mockResolvedValueOnce({ ok: true, publicKey: 'AQID' })
    .mockRejectedValueOnce(new Error('Offline'));
  await expect(enablePush()).rejects.toThrow('Offline');
  expect(subscription.unsubscribe).toHaveBeenCalledOnce();
});
it('does not unsubscribe an existing subscription owned by another account', async () => {
  getSubscription.mockResolvedValue(subscription);
  vi.mocked(apiFetch)
    .mockResolvedValueOnce({ ok: true, publicKey: 'AQID' })
    .mockRejectedValueOnce(new Error('Conflict'));
  await expect(enablePush()).rejects.toThrow('Conflict');
  expect(subscription.unsubscribe).not.toHaveBeenCalled();
});
