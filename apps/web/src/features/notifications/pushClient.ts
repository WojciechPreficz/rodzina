import { pushPublicKeyResponseSchema, pushStatusResponseSchema, pushTestResponseSchema } from '@rodzina/shared';
import { apiFetch } from '../../api.js';
import { labels } from '../../i18n/pl.js';

export function supportsPush() {
  return window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

export async function readPushStatus() {
  const supported = supportsPush();
  const registration = supported ? await navigator.serviceWorker.getRegistration() : undefined;
  const subscription = await registration?.pushManager.getSubscription();
  const status = pushStatusResponseSchema.parse(
    await apiFetch('/api/push/status', {
      method: 'POST',
      body: JSON.stringify(subscription ? { endpoint: subscription.endpoint } : {}),
    }),
  );
  return {
    ...status,
    supported,
    permission: supported ? Notification.permission : ('default' as NotificationPermission),
  };
}

export async function enablePush() {
  if (!supportsPush()) throw new Error(labels.notificationsUi.unsupported);
  // Request permission before any asynchronous work to preserve the click gesture.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted')
    throw new Error(permission === 'denied' ? labels.notificationsUi.blocked : labels.notificationsUi.dismissed);
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration?.active) throw new Error(labels.notificationsUi.workerUnavailable);
  const { publicKey } = pushPublicKeyResponseSchema.parse(await apiFetch('/api/push/public-key'));
  const raw = atob(publicKey.replace(/-/g, '+').replace(/_/g, '/'));
  const applicationServerKey = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }));
  try {
    await apiFetch('/api/push/subscriptions', { method: 'POST', body: JSON.stringify(subscription.toJSON()) });
  } catch (error) {
    // Roll back only subscriptions created by this click; another account may own an existing one.
    if (!existing) await subscription.unsubscribe();
    throw error;
  }
}

export async function sendTestPush() {
  return pushTestResponseSchema.parse(await apiFetch('/api/push/test', { method: 'POST' }));
}
