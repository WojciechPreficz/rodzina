import { useState } from 'react';
import { Alert, Button, Card, Stack, Text, Title } from '@mantine/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { useMe } from '../../auth.js';
import { labels } from '../../i18n/pl.js';
import { localScheduler } from './localSchedule.js';
import { useLocalSchedule } from './scheduleSync.js';

const text = labels.localAlarms;
const date = (value: number) =>
  new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Warsaw' }).format(value);

export function LocalAlarmsPage() {
  const { user } = useMe();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const account = user ? `${user.familyId}:${user.id}` : '';
  const query = useLocalSchedule(account);
  const { access, result, error: syncError } = query.data ?? {};
  const failure = error || syncError || query.error?.message;
  const check = async () => {
    await query.refetch();
  };
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
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
              await check();
            })
          }
        >
          {text.syncNow}
        </Button>
        <Button
          variant="light"
          disabled={busy || !account}
          onClick={() =>
            void run(async () => {
              await localScheduler.retry(account);
            })
          }
        >
          {text.retry}
        </Button>
        {failure && (
          <Alert color="red" role="alert">
            {failure}
          </Alert>
        )}
        {result && (
          <Alert color={result.complete && !failure ? 'teal' : 'orange'} role="status">
            <Text>{result.complete && !failure ? text.complete : text.incomplete}</Text>
            <Text>{text.saved(result.count, result.total)}</Text>
            <Text>
              {text.generated} {date(result.generatedAt)}
            </Text>
            <Text>
              {text.lastSync} {result.lastSuccessfulAt ? date(result.lastSuccessfulAt) : text.never}
            </Text>
            <Text>
              {text.until} {date(result.validUntil)} (Europe/Warsaw)
            </Text>
          </Alert>
        )}
        {!result && (
          <Text>
            {text.lastSync} {text.never}
          </Text>
        )}
        <Text size="sm">{text.hint}</Text>
        <Text size="sm" c="dimmed">
          {text.limitations}
        </Text>
      </Stack>
    </Card>
  );
}
