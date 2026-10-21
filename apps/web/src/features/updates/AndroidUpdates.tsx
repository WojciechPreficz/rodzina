import { Alert, Button, Card, Group, Progress, Stack, Text } from '@mantine/core';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import type { PluginListenerHandle } from '@capacitor/core';
import { isAndroid } from '../../platform.js';
import { labels } from '../../i18n/pl.js';
import { fetchWebRelease, nativeUpdates, updateService } from './updateService.js';
import type { AndroidRelease } from '@rodzina/shared';
import { useLocation } from 'react-router';

const text = labels.androidUpdates;

export function AndroidUpdateMonitor() {
  useEffect(() => {
    if (!isAndroid()) return;
    let disposed = false;
    const handles: PluginListenerHandle[] = [];
    const register = async (pending: Promise<PluginListenerHandle>) => {
      try {
        const handle = await pending;
        if (disposed) await handle.remove();
        else handles.push(handle);
      } catch {
        /* Checking remains available manually. */
      }
    };
    void updateService.check();
    void register(
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) void updateService.check();
      }),
    );
    void register(
      Network.addListener('networkStatusChange', ({ connected }) => {
        if (connected) void updateService.check();
      }),
    );
    void register(nativeUpdates.addListener('progress', updateService.progress));
    return () => {
      disposed = true;
      for (const handle of handles) void handle.remove();
    };
  }, []);
  return null;
}

export function AndroidUpdateNotice() {
  const location = useLocation();
  const state = useSyncExternalStore(updateService.subscribe, updateService.snapshot);
  if (!isAndroid() || !state.release || location.pathname === '/wiecej') return null;
  return (
    <Alert mx="md" my="sm">
      <AndroidVersion />
    </Alert>
  );
}

export function AndroidVersion() {
  const state = useSyncExternalStore(updateService.subscribe, updateService.snapshot);
  return (
    <Stack gap="sm">
      <Text fw={700}>{text.title}</Text>
      {state.release && <Text fw={600}>{text.available}</Text>}
      {state.installed && <Text>{text.installed(state.installed.name)}</Text>}
      {state.release && <Text>{text.version(state.release.versionName)}</Text>}
      {state.result === 'current' && <Text role="status">{text.current}</Text>}
      {state.result === 'unavailable' && <Text role="status">{text.unavailable}</Text>}
      {state.error && (
        <Alert color="red" role="alert">
          {state.error}
        </Alert>
      )}
      {state.busy === 'download' && (
        <>
          <Progress
            aria-label={text.downloading}
            value={
              state.progress && state.progress.total > 0
                ? Math.min(100, (state.progress.received / state.progress.total) * 100)
                : 0
            }
            animated
          />
          <Text role="status">
            {text.downloading} {state.progress ? `${(state.progress.received / 1024 / 1024).toFixed(1)} MB` : ''}
          </Text>
          <Button variant="default" onClick={() => void updateService.cancel()}>
            {text.cancel}
          </Button>
        </>
      )}
      {state.permission && <Text>{text.permission}</Text>}
      {state.installerReturned && <Text role="status">{text.returned}</Text>}
      <Group>
        <Button
          variant="light"
          disabled={!!state.busy}
          loading={state.busy === 'check'}
          onClick={() => void updateService.check(true)}
        >
          {text.check}
        </Button>
        {state.release && (
          <Button disabled={!!state.busy} onClick={() => void updateService.update()}>
            {state.downloaded ? text.retry : text.update}
          </Button>
        )}
        {state.permission && (
          <Button variant="default" disabled={!!state.busy} onClick={() => void updateService.settings()}>
            {text.settings}
          </Button>
        )}
      </Group>
    </Stack>
  );
}

export function AndroidDownload() {
  const [release, setRelease] = useState<AndroidRelease | null>(null);
  const [pending, setPending] = useState(true);
  useEffect(() => {
    if (isAndroid()) return;
    let active = true;
    void fetchWebRelease()
      .then((value) => {
        if (active) setRelease(value);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, []);
  if (isAndroid()) return null;
  return (
    <Card className="settings-card android-download-card" withBorder p="lg">
      <Stack gap="sm">
        <Text component="h2" fw={600} size="lg">
          {text.download}
        </Text>
        {pending ? (
          <Text role="status">{text.checking}</Text>
        ) : release ? (
          <>
            <Text>{text.version(release.versionName)}</Text>
            <Button component="a" href={release.apkUrl} download>
              {text.download}
            </Button>
            <Text size="sm" c="dimmed">
              {text.instructions}
            </Text>
          </>
        ) : (
          <Text role="status">{text.unavailable}</Text>
        )}
      </Stack>
    </Card>
  );
}

export function AppVersionCard() {
  return isAndroid() ? (
    <Card className="settings-card" withBorder p="lg">
      <AndroidVersion />
    </Card>
  ) : (
    <AndroidDownload />
  );
}
