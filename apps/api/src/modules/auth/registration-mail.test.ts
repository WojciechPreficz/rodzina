// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { registrationMailContent, sendRegistrationMail } from './registration-mail.js';
import { sendMail } from './reset-mail.js';
import { loadConfig } from '../../config.js';

vi.mock('./reset-mail.js', () => ({ sendMail: vi.fn().mockResolvedValue(undefined) }));

it('uses the shared encrypted SMTP sender with Polish confirmation content and no trackers', async () => {
  const mail = {
    to: 'anna@example.com',
    link: 'https://example.com/potwierdz-rodzine?a=1&b="test"#token=abc',
    expiresAt: Date.UTC(2026, 10, 9),
  };
  const content = registrationMailContent(mail);
  expect(content.subject).toContain('potwierdź');
  expect(content.text).toContain('24 godziny');
  expect(content.text).toContain('2026-11-09T00:00:00.000Z');
  expect(content.text).toContain('Dopiero po potwierdzeniu');
  expect(content.text).toContain('zignoruj');
  expect(content.html).toContain('&amp;b=&quot;test&quot;');
  expect(content.html).not.toContain('<img');
  const config = loadConfig({});
  await sendRegistrationMail(config, mail);
  expect(sendMail).toHaveBeenCalledWith(config, { to: mail.to, ...content });
});
