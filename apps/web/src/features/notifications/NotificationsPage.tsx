import { Card, Stack, Text, Title } from '@mantine/core';
import { labels } from '../../i18n/pl.js';
import { isAndroid } from '../../platform.js';
import { LocalAlarmsPage } from './LocalAlarmsPage.js';
import { AndroidDownload } from '../updates/AndroidUpdates.js';

export function NotificationsPage() {
  if (isAndroid()) return <LocalAlarmsPage />;
  return (
    <Card withBorder radius="lg" p="lg">
      <Stack>
        <Title order={2}>{labels.notificationsUi.title}</Title>
        <Text>{labels.notificationsUi.androidOnly}</Text>
        <Text>{labels.notificationsUi.offlineHint}</Text>
        <AndroidDownload />
      </Stack>
    </Card>
  );
}
