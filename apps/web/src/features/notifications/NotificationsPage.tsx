import { PageHeader } from '../../components/PageHeader.js';
import { Card, Stack, Text } from '@mantine/core';
import { labels } from '../../i18n/pl.js';
import { isAndroid } from '../../platform.js';
import { LocalAlarmsPage } from './LocalAlarmsPage.js';
import { AndroidDownload } from '../updates/AndroidUpdates.js';

export function NotificationsPage() {
  if (isAndroid()) return <LocalAlarmsPage />;
  return (
    <Stack className="settings-page" gap="lg">
      <PageHeader title={labels.notificationsUi.title} />
      <Card className="settings-card" withBorder p="lg">
        <Stack gap="md">
          <Text>{labels.notificationsUi.androidOnly}</Text>
          <Text>{labels.notificationsUi.offlineHint}</Text>
        </Stack>
      </Card>
      <AndroidDownload />
    </Stack>
  );
}
