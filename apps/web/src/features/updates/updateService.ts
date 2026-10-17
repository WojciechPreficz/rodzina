import { App } from '@capacitor/app';
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { hasNewAndroidVersion, parseAndroidRelease, type AndroidRelease } from '@rodzina/shared';
import { labels } from '../../i18n/pl.js';

export const releaseOrigin = 'https://rodzina.preficze.pl';
export const nativeUpdates = registerPlugin<{
  latest(): Promise<{ available: boolean; release?: unknown }>;
  download(release: AndroidRelease): Promise<void>;
  cancel(): Promise<void>;
  install(): Promise<{ needsPermission?: boolean; installerReturned?: boolean }>;
  settings(): Promise<void>;
  addListener(
    event: 'progress',
    callback: (progress: { received: number; total: number }) => void,
  ): Promise<PluginListenerHandle>;
}>('RodzinaUpdates');

export async function fetchWebRelease(): Promise<AndroidRelease | null> {
  const response = await fetch('/downloads/android/latest.json', {
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Release unavailable');
  const text = await response.text();
  if (text.length > 4096) throw new Error('Invalid metadata size');
  return parseAndroidRelease(JSON.parse(text), window.location.origin);
}

export type UpdateState = {
  busy: 'check' | 'download' | 'install' | null;
  installed?: { code: number; name: string } | undefined;
  release?: AndroidRelease | undefined;
  result?: 'current' | 'unavailable' | undefined;
  error?: string | undefined;
  downloaded?: boolean | undefined;
  permission?: boolean | undefined;
  installerReturned?: boolean | undefined;
  progress?: { received: number; total: number } | undefined;
};

type Dependencies = {
  installed(): Promise<{ code: number; name: string }>;
  latest(): Promise<unknown | null>;
  download(release: AndroidRelease): Promise<void>;
  install(): Promise<{ needsPermission?: boolean; installerReturned?: boolean }>;
  cancel(): Promise<void>;
  settings(): Promise<void>;
  now(): number;
};

export function createUpdateService(deps: Dependencies) {
  let state: UpdateState = { busy: null };
  let checkedAt = -Infinity;
  let checking: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<UpdateState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const service = {
    snapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    progress: (progress: { received: number; total: number }) => {
      if (state.busy === 'download') set({ progress });
    },
    check(manual = false): Promise<void> {
      if (checking) return checking;
      if (state.busy || (!manual && deps.now() - checkedAt < 15 * 60 * 1000)) return Promise.resolve();
      checkedAt = deps.now();
      set({ busy: 'check', ...(manual ? { error: undefined, result: undefined } : {}) });
      checking = (async () => {
        try {
          const installed = await deps.installed();
          if (!Number.isInteger(installed.code) || installed.code <= 0) throw new Error('Invalid installed version.');
          set({ installed });
          const raw = await deps.latest();
          const release = raw === null ? null : parseAndroidRelease(raw, releaseOrigin);
          const newer = release !== null && hasNewAndroidVersion(installed.code, release);
          const sameDownload =
            newer && state.release?.sha256 === release.sha256 && state.release.apkUrl === release.apkUrl;
          set({
            release: newer ? release : undefined,
            result: release === null ? 'unavailable' : newer ? undefined : 'current',
            downloaded: sameDownload && state.downloaded,
            permission: sameDownload && state.permission,
            error: undefined,
          });
        } catch {
          if (manual) set({ error: labels.androidUpdates.checkError });
        } finally {
          set({ busy: null });
          checking = undefined;
        }
      })();
      return checking;
    },
    async update() {
      if (state.busy || !state.release) return;
      set({ error: undefined, installerReturned: false });
      try {
        if (!state.downloaded) {
          set({ busy: 'download', progress: undefined, permission: false });
          await deps.download(state.release);
          set({ downloaded: true });
        }
        set({ busy: 'install' });
        const result = await deps.install();
        set({ permission: result.needsPermission, installerReturned: result.installerReturned });
      } catch (error) {
        set({ error: error instanceof Error ? error.message : labels.androidUpdates.updateError, downloaded: false });
      } finally {
        set({ busy: null });
      }
    },
    async cancel() {
      try {
        await deps.cancel();
      } catch {
        set({ error: labels.androidUpdates.cancelError });
      }
    },
    async settings() {
      try {
        await deps.settings();
      } catch {
        set({ error: labels.androidUpdates.settingsError });
      }
    },
  };
  return service;
}

export const updateService = createUpdateService({
  installed: async () => {
    const info = await App.getInfo();
    return { code: Number(info.build), name: info.version };
  },
  latest: async () => {
    const result = await nativeUpdates.latest();
    return result.available ? result.release : null;
  },
  download: (release) => nativeUpdates.download(release),
  install: () => nativeUpdates.install(),
  cancel: () => nativeUpdates.cancel(),
  settings: () => nativeUpdates.settings(),
  now: Date.now,
});
