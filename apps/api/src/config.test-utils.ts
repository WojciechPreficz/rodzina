import webPush from 'web-push';
import { loadConfig } from './config.js';

const vapid = webPush.generateVAPIDKeys();
export const testVapidEnvironment = {
  RODZINA_VAPID_PUBLIC_KEY: vapid.publicKey,
  RODZINA_VAPID_PRIVATE_KEY: vapid.privateKey,
  RODZINA_VAPID_SUBJECT: 'mailto:test@example.com',
};

export function loadTestConfig(environment: NodeJS.ProcessEnv) {
  return loadConfig({ ...testVapidEnvironment, ...environment });
}
