import { Alert, Button, Card, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { labels } from '../../i18n/pl.js';
import { usePushActions, usePushStatus } from './pushQueries.js';
import { isAndroid } from '../../platform.js';
import { LocalAlarmsPage } from './LocalAlarmsPage.js';

const text = labels.notificationsUi;

export function NotificationsPage() {
  const status = usePushStatus();
  const { enable, test } = usePushActions();
  if (isAndroid()) return <LocalAlarmsPage />;
  const data = status.data;
  const active = data?.supported && data.permission === 'granted' && data.subscribed;
  const description = !data
    ? null
    : !data.supported
      ? text.unsupported
      : data.permission === 'denied'
        ? text.blocked
        : active
          ? text.enabled
          : text.disabled;
  return (
    <Card withBorder radius="lg" p="lg">
      <Stack>
        <Title order={2}>{text.title}</Title>
        {status.isPending && <Loader aria-label={text.loading} />}
        {description && <Text role="status">{description}</Text>}
        {status.error && (
          <Alert color="red">
            {status.error.message}
            <Button
              variant="subtle"
              onClick={() => {
                void status.refetch();
              }}
            >
              {labels.calendarUi.retry}
            </Button>
          </Alert>
        )}
        <Group>
          {data?.supported && data.permission !== 'denied' && !active && (
            <Button
              loading={enable.isPending}
              onClick={() => {
                test.reset();
                enable.mutate();
              }}
            >
              {text.enable}
            </Button>
          )}
          {active && (
            <Button
              loading={test.isPending}
              onClick={() => {
                enable.reset();
                test.mutate();
              }}
            >
              {text.test}
            </Button>
          )}
        </Group>
        {(enable.error || test.error) && (
          <Alert color="red" role="alert">
            {enable.error?.message ?? test.error?.message}
          </Alert>
        )}
        {test.data && (
          <Alert
            color={test.data.sent > 0 && test.data.failed === 0 && test.data.removed === 0 ? 'teal' : 'orange'}
            role="status"
          >
            {text.testResult(test.data.sent, test.data.failed, test.data.removed)}
          </Alert>
        )}
        <Title order={3} size="h4">
          {text.installTitle}
        </Title>
        <Text>{text.install}</Text>
        <Text size="sm" c="dimmed">
          {text.systemHint}
        </Text>
      </Stack>
    </Card>
  );
}
