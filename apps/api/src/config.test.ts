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
