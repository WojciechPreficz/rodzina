import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'der' },
});

const publicBytes = publicKey.subarray(-65);
const privateBytes = privateKey.subarray(-32);
console.log(`RODZINA_VAPID_PUBLIC_KEY=${publicBytes.toString('base64url')}`);
console.log(`RODZINA_VAPID_PRIVATE_KEY=${privateBytes.toString('base64url')}`);
console.log('RODZINA_VAPID_SUBJECT=mailto:admin@example.com');
