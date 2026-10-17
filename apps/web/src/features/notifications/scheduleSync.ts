import { useEffect } from 'react';
import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import type { PluginListenerHandle } from '@capacitor/core';
import { focusManager, onlineManager, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { isAndroid } from '../../platform.js';
import { SYNC_INTERVAL_MS } from '../../queryClient.js';
import { localScheduler } from './localSchedule.js';

export const scheduleKey = ['local-schedule'];

export async function refreshLocalSchedule(client: QueryClient) {
  if (!isAndroid()) return;
  localScheduler.invalidate();
  await client.cancelQueries({ queryKey: scheduleKey });
  await client.invalidateQueries({ queryKey: scheduleKey });
}

export function useLocalSchedule(account: string, automatic = false) {
  return useQuery({
    queryKey: [...scheduleKey, account],
    enabled: isAndroid() && Boolean(account),
    networkMode: 'always',
    retry: false,
    refetchInterval: () => (automatic && focusManager.isFocused() ? SYNC_INTERVAL_MS : false),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    queryFn: async ({ signal }) => {
      const abort = () => localScheduler.invalidate();
      signal.addEventListener('abort', abort, { once: true });
      try {
        const access = await localScheduler.permissions();
        signal.throwIfAborted();
        let error: string | undefined;
        let result;
        try {
          result = await localScheduler.sync(account);
        } catch (failure) {
          signal.throwIfAborted();
          error = failure instanceof Error ? failure.message : String(failure);
          result = await localScheduler.status(account);
        }
        signal.throwIfAborted();
        return { access, result, error };
      } finally {
        signal.removeEventListener('abort', abort);
      }
    },
  });
}

export function ScheduleSync({ account }: { account: string }) {
  useLocalSchedule(account, true);
  const client = useQueryClient();
  useEffect(() => {
    if (!isAndroid() || !account) return;
    let disposed = false;
    let activeRevision = 0;
    let networkRevision = 0;
    const handles: PluginListenerHandle[] = [];
    const register = async (pending: Promise<PluginListenerHandle>) => {
      const handle = await pending;
      if (disposed) await handle.remove();
      else handles.push(handle);
    };
    const resume = (active: boolean) => {
      focusManager.setFocused(active);
      if (active) void client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'local-schedule' });
    };
    const connect = (connected: boolean) => {
      onlineManager.setOnline(connected);
    };
    void Promise.all([
      register(
        App.addListener('appStateChange', ({ isActive }) => {
          activeRevision += 1;
          if (!disposed) resume(isActive);
        }),
      ),
      register(
        Network.addListener('networkStatusChange', ({ connected }) => {
          networkRevision += 1;
          if (!disposed) connect(connected);
        }),
      ),
    ])
      .then(async () => {
        const appRevision = activeRevision;
        const netRevision = networkRevision;
        const [app, network] = await Promise.all([App.getState(), Network.getStatus()]);
        if (disposed) return;
        if (activeRevision === appRevision) resume(app.isActive);
        if (networkRevision === netRevision) connect(network.connected);
      })
      .catch(() => {
        if (!disposed) void client.invalidateQueries({ queryKey: scheduleKey });
      });
    return () => {
      disposed = true;
      for (const handle of handles) void handle.remove();
      focusManager.setFocused(undefined);
      onlineManager.setOnline(navigator.onLine);
    };
  }, [account, client]);
  return null;
}
