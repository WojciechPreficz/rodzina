// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import webPush from 'web-push';
import { loadTestConfig } from '../../config.test-utils.js';
import { createPushSender } from './sender.js';

vi.mock('web-push', async (importOriginal) => {
  const original = await importOriginal<{ default: typeof webPush }>();
  return { default: { ...original.default, sendNotification: vi.fn() } };
});

describe('Web Push adapter', () => {
  it('passes raw subscription keys, JSON payload and per-call VAPID credentials', async () => {
    const config = loadTestConfig({ NODE_ENV: 'test' });
    const subscription = { endpoint: 'https://push.example.com/device', p256dh: 'public', auth: 'auth' };
    const payload = { title: 'Basen', body: '', tag: 'event', url: '/kalendarz' };
    await createPushSender(config).send(subscription, payload);
    expect(webPush.sendNotification).toHaveBeenCalledWith(
      { endpoint: subscription.endpoint, keys: { p256dh: 'public', auth: 'auth' } },
      JSON.stringify(payload),
      {
        vapidDetails: {
          subject: config.RODZINA_VAPID_SUBJECT,
          publicKey: config.RODZINA_VAPID_PUBLIC_KEY,
          privateKey: config.RODZINA_VAPID_PRIVATE_KEY,
        },
        TTL: 7200,
        timeout: 10000,
      },
    );
  });
});
