// @vitest-environment node
import { ECDH } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

it.each([1, 31, 32])('accepts generated VAPID keys with a %i-byte private scalar', async (bytes) => {
  vi.resetModules();
  vi.spyOn(ECDH.prototype, 'generateKeys').mockImplementation(function (this: ECDH) {
    this.setPrivateKey(Buffer.alloc(bytes, 1));
    return this.getPublicKey('hex');
  });
  const { loadTestConfig, testVapidEnvironment } = await import('./config.test-utils.js');
  const privateKey = Buffer.from(testVapidEnvironment.RODZINA_VAPID_PRIVATE_KEY, 'base64url');
  expect(privateKey.length).toBe(32);
  expect(privateKey.subarray(0, 32 - bytes)).toEqual(Buffer.alloc(32 - bytes));
  expect(loadTestConfig({ NODE_ENV: 'test' }).RODZINA_VAPID_PRIVATE_KEY).toBe(
    testVapidEnvironment.RODZINA_VAPID_PRIVATE_KEY,
  );
});
