import webPush from 'web-push';

const vapid = webPush.generateVAPIDKeys();
console.log(`RODZINA_VAPID_PUBLIC_KEY=${vapid.publicKey}`);
console.log(`RODZINA_VAPID_PRIVATE_KEY=${vapid.privateKey}`);
console.log('RODZINA_VAPID_SUBJECT=mailto:admin@example.com');
