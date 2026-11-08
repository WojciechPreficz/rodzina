import { loadConfig } from '../../apps/api/src/config.js';
import { createDatabase } from '../../apps/api/src/db/client.js';
import { buildFixtureApp } from '../../apps/api/src/test-fixtures.js';
import type { RegistrationMail } from '../../apps/api/src/modules/auth/registration-mail.js';

// Local test server only; no fixture route or inbox is bundled with the release.
const config = {
  ...loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    RODZINA_SMTP_HOST: 'unused.example.com',
    RODZINA_SMTP_USER: 'test',
    RODZINA_SMTP_PASSWORD: 'test-only',
    RODZINA_MAIL_FROM: 'sender@example.com',
  }),
  NODE_ENV: 'production' as const,
};
const database = createDatabase(config);
const inbox = new Map<string, RegistrationMail>();
const app = await buildFixtureApp(config, database, undefined, async (_config, mail) => {
  inbox.set(mail.to, mail);
});
app.get('/api/test/registration-mail', { config: { auth: 'public' } }, async (request) => {
  return inbox.get((request.query as { email: string }).email) ?? null;
});
await app.listen({ host: '127.0.0.1', port: config.PORT });
