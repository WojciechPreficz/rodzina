import webPush from 'web-push';
import type { AppConfig } from '../../config.js';
import type { ReminderPayload } from '../reminders/delivery.js';

export interface PushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSender {
  send(subscription: PushSubscription, payload: ReminderPayload): Promise<void>;
}

export function createPushSender(config: AppConfig): PushSender {
  return {
    async send(subscription, payload) {
      await webPush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
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
    },
  };
}
