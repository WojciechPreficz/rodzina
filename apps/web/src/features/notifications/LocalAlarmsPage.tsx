import { useEffect, useState } from 'react';
import { Alert, Button, Card, Stack, Text, Title } from '@mantine/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { useMe } from '../../auth.js';
import { labels } from '../../i18n/pl.js';
import { localScheduler, type ScheduleResult } from './localSchedule.js';

const text = labels.localAlarms;
const date = (value: number) =>
  new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Warsaw' }).format(value);

export function LocalAlarmsPage() {
  const { user } = useMe();
  const [access, setAccess] = useState<Awaited<ReturnType<typeof localScheduler.permissions>>>();
  const [result, setResult] = useState<ScheduleResult>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const account = user ? `${user.familyId}:${user.id}` : '';
  async function check() {
    setAccess(await localScheduler.permissions());
  }
  useEffect(() => {
    void check().catch(() => setError(text.error));
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setResult(undefined);
    try {
      await action();
      await check();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : text.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card withBorder radius="lg" p="lg">
      <Stack>
        <Title order={2}>{text.title}</Title>
        {access && (
          <>
            <Text>{text.displayStatus(access.display === 'granted')}</Text>
            <Text>{text.exactStatus(access.exact === 'granted')}</Text>
          </>
        )}
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await LocalNotifications.requestPermissions();
            })
          }
        >
          {text.enable}
        </Button>
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await LocalNotifications.changeExactNotificationSetting();
            })
          }
        >
          {text.exact}
        </Button>
        <Button variant="subtle" disabled={busy} onClick={() => void run(check)}>
          {text.check}
        </Button>
        <Button
          loading={busy}
          disabled={!account}
          onClick={() =>
            void run(async () => {
              setResult(await localScheduler.sync(account));
            })
          }
        >
          {text.download}
        </Button>
        <Button
          variant="light"
          disabled={busy || !account}
          onClick={() =>
            void run(async () => {
              setResult(await localScheduler.retry(account));
            })
          }
        >
          {text.retry}
        </Button>
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        {result && (
          <Alert color={result.complete ? 'teal' : 'orange'} role="status">
            <Text>{result.complete ? text.complete : text.incomplete}</Text>
            <Text>{text.saved(result.count, result.total)}</Text>
            <Text>
              {text.generated} {date(result.generatedAt)}
            </Text>
            <Text>
              {text.until} {date(result.validUntil)} (Europe/Warsaw)
            </Text>
          </Alert>
        )}
        <Text size="sm">{text.hint}</Text>
        <Text size="sm" c="dimmed">
          {text.limitations}
        </Text>
      </Stack>
    </Card>
  );
}
