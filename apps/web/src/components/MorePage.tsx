import { Stack } from '@mantine/core';
import { PageHeader } from './PageHeader.js';
import { labels } from '../i18n/pl.js';
import { AppVersionCard } from '../features/updates/AndroidUpdates.js';

export function MorePage() {
  return (
    <Stack className="settings-page" gap="lg">
      <PageHeader title={labels.androidUpdates.title} />
      <AppVersionCard />
    </Stack>
  );
}
