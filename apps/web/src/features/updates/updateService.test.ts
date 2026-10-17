import { afterEach, expect, it, vi } from 'vitest';
import { createUpdateService, fetchWebRelease } from './updateService.js';

const release = {
  versionCode: 2,
  versionName: '1.0.1',
  apkUrl: 'https://rodzina.preficze.pl/downloads/android/rodzina-2-1.0.1.apk',
  sha256: 'ab'.repeat(32),
};
function setup() {
  const deps = {
    installed: vi.fn(async () => ({ code: 1, name: '1.0.0' })),
    latest: vi.fn<() => Promise<unknown>>(async () => release),
    download: vi.fn(async () => undefined),
    install: vi.fn(async (): Promise<{ needsPermission?: boolean; installerReturned?: boolean }> => ({
      installerReturned: true,
    })),
    settings: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    now: () => 100000,
  };
  return { deps, service: createUpdateService(deps) };
}
afterEach(() => vi.unstubAllGlobals());
it('throttles startup/resume/network checks, coalesces requests, and allows manual retry', async () => {
  const { deps, service } = setup();
  await Promise.all([service.check(), service.check(), service.check()]);
  await service.check();
  expect(deps.latest).toHaveBeenCalledTimes(1);
  await service.check(true);
  expect(deps.latest).toHaveBeenCalledTimes(2);
  expect(service.snapshot().release).toEqual(release);
});
it('keeps an available update usable after network failure and reports manual errors', async () => {
  const { deps, service } = setup();
  await service.check();
  deps.latest.mockRejectedValue(new Error('offline'));
  await service.check(true);
  expect(service.snapshot()).toMatchObject({ release, busy: null, error: expect.stringContaining('połączenie') });
});
it('does not invoke the installer when downloading rejects a corrupted file', async () => {
  const { deps, service } = setup();
  await service.check();
  deps.download.mockRejectedValue(new Error('Suma SHA-256 nie zgadza się.'));
  await service.update();
  expect(deps.install).not.toHaveBeenCalled();
  expect(service.snapshot()).toMatchObject({
    busy: null,
    downloaded: false,
    error: expect.stringContaining('SHA-256'),
  });
});
it('retries installation after permission without downloading again and never reports installation success', async () => {
  const { deps, service } = setup();
  deps.install.mockResolvedValueOnce({ needsPermission: true });
  await service.check();
  await service.update();
  expect(service.snapshot()).toMatchObject({ permission: true, downloaded: true });
  await service.settings();
  await service.check(true);
  await service.update();
  expect(deps.download).toHaveBeenCalledTimes(1);
  expect(deps.settings).toHaveBeenCalledOnce();
  expect(service.snapshot()).toMatchObject({ installerReturned: true });
});
it('ignores stale progress outside a transfer and exposes cancellation', async () => {
  const { service, deps } = setup();
  service.progress({ received: 10, total: 100 });
  expect(service.snapshot().progress).toBeUndefined();
  await service.cancel();
  expect(deps.cancel).toHaveBeenCalledOnce();
});
it.each([1, 2, 3])('offers only newer releases for installed version %s', async (code) => {
  const { deps, service } = setup();
  deps.installed.mockResolvedValue({ code, name: 'test' });
  await service.check();
  expect(!!service.snapshot().release).toBe(code < 2);
});
it('treats 404 as no published APK and rejects bad metadata', async () => {
  const { deps, service } = setup();
  deps.latest.mockResolvedValue(null);
  await service.check();
  expect(service.snapshot().result).toBe('unavailable');
  deps.latest.mockResolvedValue({ ...release, apkUrl: 'https://evil.example/app.apk' });
  await service.check(true);
  expect(service.snapshot().release).toBeUndefined();
  expect(service.snapshot().error).toBeDefined();
});
it('web metadata bypasses cache and credentials, and does not follow redirects', async () => {
  const fetch = vi.fn(async () => new Response('', { status: 404 }));
  vi.stubGlobal('fetch', fetch);
  expect(await fetchWebRelease()).toBeNull();
  expect(fetch).toHaveBeenCalledWith(
    '/downloads/android/latest.json',
    expect.objectContaining({ cache: 'no-store', credentials: 'omit', redirect: 'error' }),
  );
  fetch.mockResolvedValue(new Response('bad JSON', { status: 200 }));
  await expect(fetchWebRelease()).rejects.toThrow();
});
