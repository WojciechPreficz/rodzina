// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { testVapidEnvironment } from './config.test-utils.js';

describe('VAPID configuration', () => {
  it('accepts matching raw P-256 keys and a contact', () => {
    expect(loadConfig(testVapidEnvironment).RODZINA_VAPID_PUBLIC_KEY).toBe(
      testVapidEnvironment.RODZINA_VAPID_PUBLIC_KEY,
    );
    expect(loadConfig({ ...testVapidEnvironment, RODZINA_VAPID_SUBJECT: 'https://example.com/contact' })).toBeDefined();
  });
  it('requires all three variables, also in test mode', () => {
    for (const key of Object.keys(testVapidEnvironment)) {
      expect(() => loadConfig({ NODE_ENV: 'test', ...testVapidEnvironment, [key]: undefined })).toThrow();
    }
  });
  it.each([
    { RODZINA_VAPID_PUBLIC_KEY: 'invalid' },
    { RODZINA_VAPID_PRIVATE_KEY: Buffer.alloc(32).toString('base64url') },
    { RODZINA_VAPID_PRIVATE_KEY: Buffer.alloc(32, 1).toString('base64url') },
    { RODZINA_VAPID_SUBJECT: 'http://example.com' },
    { RODZINA_VAPID_SUBJECT: 'mailto:invalid' },
  ])('rejects invalid keys and contacts: %j', (override) => {
    expect(() => loadConfig({ ...testVapidEnvironment, ...override })).toThrow();
  });
});
