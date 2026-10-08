import { Paper, Text } from '@mantine/core';
import { labels } from '../i18n/pl.js';

export function EmptyPage({ title }: { title: string }) {
  return (
    <Paper withBorder radius="lg" p="lg">
      <Text component="h2" size="lg" fw={600} mb="xs">
        {title}
      </Text>
      <Text c="dimmed">{labels.comingSoon}</Text>
    </Paper>
  );
}
