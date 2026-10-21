import { Paper, Stack, Text } from '@mantine/core';
import { PageHeader } from './PageHeader.js';
import { labels } from '../i18n/pl.js';

export function EmptyPage({ title }: { title: string }) {
  return (
    <Stack className="settings-page" gap="lg">
      <PageHeader title={title} />
      <Paper className="settings-card placeholder-card" withBorder p="xl">
        <Text c="dimmed">{labels.comingSoon}</Text>
      </Paper>
    </Stack>
  );
}
