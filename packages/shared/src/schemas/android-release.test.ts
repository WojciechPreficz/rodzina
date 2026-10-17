import { expect, it } from 'vitest';
import { hasNewAndroidVersion, parseAndroidRelease } from './android-release.js';

const origin = 'https://rodzina.preficze.pl';
const release = {
  versionCode: 2,
  versionName: '1.0.1',
  apkUrl: `${origin}/downloads/android/rodzina-2-1.0.1.apk`,
  sha256: 'ab'.repeat(32),
};
it('compares numeric version codes without suggesting downgrades', () => {
  const parsed = parseAndroidRelease(release, origin);
  expect(hasNewAndroidVersion(1, parsed)).toBe(true);
  expect(hasNewAndroidVersion(2, parsed)).toBe(false);
  expect(hasNewAndroidVersion(3, parsed)).toBe(false);
});
it.each([
  { versionCode: '2' },
  { versionCode: -1 },
  { versionCode: 1.5 },
  { versionCode: 2100000001 },
  { sha256: 'invalid' },
  { versionName: '../secret' },
  { apkUrl: 'https://evil.example/downloads/android/rodzina-2-1.0.1.apk' },
  { apkUrl: `${origin}/api/private.apk` },
  { apkUrl: `${origin}/downloads/android/rodzina-1-1.0.0.apk` },
  { apkUrl: 'http://rodzina.preficze.pl/downloads/android/rodzina-2-1.0.1.apk' },
  { apkUrl: `${origin}/downloads/android/rodzina-2-1.0.1.apk?token=secret` },
  { apkUrl: 'https://user@rodzina.preficze.pl/downloads/android/rodzina-2-1.0.1.apk' },
])('rejects unsafe or inconsistent release metadata: %j', (patch) => {
  expect(() => parseAndroidRelease({ ...release, ...patch }, origin)).toThrow();
});
