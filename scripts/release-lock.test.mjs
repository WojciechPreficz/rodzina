// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { releaseLock, releaseManifest, validateReleaseContract, validateReleaseFiles } from './release-lock.mjs';

const node = (version, extra = {}) => ({
  version,
  resolved: `https://registry.npmjs.org/pkg/-/pkg-${version}.tgz`,
  integrity: 'sha512-test',
  ...extra,
});
const manifest = releaseManifest({ version: '1.0.0', dependencies: { api: '^1', '@rodzina/shared': '*' } });
const source = () => ({
  lockfileVersion: 3,
  packages: {
    'node_modules/api': node('1.2.0', { dependencies: { child: '^2' }, optionalDependencies: { native: '3' } }),
    'node_modules/api/node_modules/child': node('2.1.0', { dev: true }),
    'node_modules/native': node('3.0.0', { optional: true, os: ['linux'], cpu: ['x64'] }),
    'node_modules/unrelated': node('9.0.0', { dev: true }),
  },
});

describe('release lockfile', () => {
  it('stops packaging on API manifest, release manifest or transitive lockfile drift', () => {
    const api = { version: '1.0.0', dependencies: { api: '^1', '@rodzina/shared': '*' } };
    const lock = source();
    lock.packages['apps/api'] = { dependencies: api.dependencies };
    const release = releaseLock(manifest, lock);
    expect(() => validateReleaseContract(api, lock, manifest, release)).not.toThrow();
    expect(() => validateReleaseContract({ ...api, dependencies: { api: '^2' } }, lock, manifest, release)).toThrow(
      'API manifest',
    );
    expect(() => validateReleaseContract(api, lock, { ...manifest, version: '2.0.0' }, release)).toThrow('stale');
    const stale = structuredClone(release);
    stale.packages['node_modules/api/node_modules/child'].version = '2.0.0';
    expect(() => validateReleaseContract(api, lock, manifest, stale)).toThrow('stale');
  });
  it('matches the committed API and monorepo runtime tree', async () => {
    await expect(validateReleaseFiles()).resolves.toBeUndefined();
  });
  it('preserves nested versions, integrity and platform metadata without workspace or dev-only packages', () => {
    const lock = releaseLock(manifest, source());
    expect(manifest.dependencies).toEqual({ api: '^1' });
    expect(Object.keys(lock.packages)).toHaveLength(4);
    expect(lock.packages['node_modules/api/node_modules/child']).toEqual(node('2.1.0'));
    expect(lock.packages['node_modules/native']).toMatchObject({
      version: '3.0.0',
      optional: true,
      os: ['linux'],
      cpu: ['x64'],
    });
    expect(lock.packages['node_modules/unrelated']).toBeUndefined();
  });
  it('propagates optional status but preserves dependencies also reached through a required path', () => {
    const lock = source();
    lock.packages['node_modules/native'].dependencies = { child: '^4' };
    lock.packages['node_modules/child'] = node('4.0.0');
    const projected = releaseLock(manifest, lock);
    expect(projected.packages['node_modules/child'].optional).toBe(true);
    lock.packages['node_modules/api'].dependencies.child = '^4';
    delete lock.packages['node_modules/api/node_modules/child'];
    expect(releaseLock(manifest, lock).packages['node_modules/child'].optional).toBeUndefined();
  });
  it('tracks changed transitive versions and rejects missing or unpinned runtime nodes', () => {
    const original = releaseLock(manifest, source());
    const changed = source();
    changed.packages['node_modules/api/node_modules/child'] = node('2.2.0');
    expect(releaseLock(manifest, changed)).not.toEqual(original);
    delete changed.packages['node_modules/api/node_modules/child'];
    expect(() => releaseLock(manifest, changed)).toThrow('Missing locked runtime dependency');
    const unpinned = source();
    delete unpinned.packages['node_modules/api'].integrity;
    expect(() => releaseLock(manifest, unpinned)).toThrow('integrity-locked');
  });
});
