import { Card, Stack, Title } from '@mantine/core';
import { labels } from '../i18n/pl.js';
import { AppVersionCard } from '../features/updates/AndroidUpdates.js';

export function MorePage() {
  return (
    <Card withBorder radius="lg" p="lg">
      <Stack gap="lg">
        <Title order={2}>{labels.androidUpdates.title}</Title>
        <AppVersionCard />
      </Stack>
    </Card>
  );
}
