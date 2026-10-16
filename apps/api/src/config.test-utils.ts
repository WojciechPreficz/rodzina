import { createECDH } from 'node:crypto';
import { loadConfig } from './config.js';

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
export const testVapidEnvironment = {
  RODZINA_VAPID_PUBLIC_KEY: ecdh.getPublicKey().toString('base64url'),
  RODZINA_VAPID_PRIVATE_KEY: ecdh.getPrivateKey().toString('base64url'),
  RODZINA_VAPID_SUBJECT: 'mailto:test@example.com',
};

export function loadTestConfig(environment: NodeJS.ProcessEnv) {
  return loadConfig({ ...testVapidEnvironment, ...environment });
}
