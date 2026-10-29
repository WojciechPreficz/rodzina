// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('configuration without Web Push', () => {
  it.each(['development', 'test', 'production'])('starts in %s without VAPID', (NODE_ENV) => {
    expect(loadConfig({ NODE_ENV }).NODE_ENV).toBe(NODE_ENV);
  });
  it('ignores obsolete variables from an existing environment file, even invalid or empty ones', () => {
    expect(
      loadConfig({
        NODE_ENV: 'production',
        RODZINA_VAPID_PUBLIC_KEY: 'obsolete',
        RODZINA_VAPID_PRIVATE_KEY: '',
        RODZINA_VAPID_SUBJECT: 'invalid contact',
        RODZINA_OLD_SETTING: 'ignored',
      }),
    ).toEqual(loadConfig({ NODE_ENV: 'production' }));
  });
});

describe('backup configuration', () => {
  it('defaults to the local data directory and accepts a custom destination', () => {
    expect(loadConfig({}).RODZINA_BACKUP_DIR).toBe('./apps/api/data/backups');
    expect(loadConfig({ RODZINA_BACKUP_DIR: '/data/backups' }).RODZINA_BACKUP_DIR).toBe('/data/backups');
  });
  it('rejects an empty destination', () => {
    expect(() => loadConfig({ RODZINA_BACKUP_DIR: '  ' })).toThrow();
  });
});

describe('SMTP configuration', () => {
  const smtp = {
    RODZINA_PASSWORD_RESET_EMAIL_ENABLED: 'true',
    RODZINA_SMTP_HOST: 'smtp.example.com',
    RODZINA_SMTP_USER: 'sender',
    RODZINA_SMTP_PASSWORD: 'test-only',
    RODZINA_MAIL_FROM: 'sender@example.com',
  };
  it('is disabled by default without SMTP credentials', () => {
    expect(loadConfig({}).RODZINA_PASSWORD_RESET_EMAIL_ENABLED).toBe(false);
  });
  it.each(['RODZINA_SMTP_HOST', 'RODZINA_SMTP_USER', 'RODZINA_SMTP_PASSWORD', 'RODZINA_MAIL_FROM'])(
    'requires %s only when enabled',
    (field) => expect(() => loadConfig({ ...smtp, [field]: '' })).toThrow(),
  );
  it('accepts direct TLS and mandatory STARTTLS settings', () => {
    expect(loadConfig({ ...smtp, RODZINA_SMTP_PORT: '465', RODZINA_SMTP_SECURE: 'true' }).RODZINA_SMTP_SECURE).toBe(
      true,
    );
    expect(loadConfig(smtp).RODZINA_SMTP_SECURE).toBe(false);
  });
  it.each([
    'http://example.com',
    'https://user:password@example.com',
    'https://example.com/path',
    'https://example.com/?query=x',
    'https://example.com/#fragment',
  ])('rejects unsafe production public URL %s', (url) =>
    expect(() => loadConfig({ ...smtp, NODE_ENV: 'production', RODZINA_PUBLIC_URL: url })).toThrow(),
  );
  it('requires a valid sender and SMTP port', () => {
    expect(() => loadConfig({ ...smtp, RODZINA_MAIL_FROM: 'not an email' })).toThrow();
    expect(() => loadConfig({ ...smtp, RODZINA_SMTP_PORT: '65536' })).toThrow();
    expect(() => loadConfig({ ...smtp, RODZINA_SMTP_SECURE: 'no' })).toThrow();
  });
  it('trusts no forwarding by default and accepts an explicit list', () => {
    expect(loadConfig({}).RODZINA_TRUSTED_PROXIES).toEqual([]);
    expect(loadConfig({ RODZINA_TRUSTED_PROXIES: '127.0.0.1, ::1' }).RODZINA_TRUSTED_PROXIES).toEqual([
      '127.0.0.1',
      '::1',
    ]);
  });
});
