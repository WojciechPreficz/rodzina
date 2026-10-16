import { Alert, Button, Stack, Text } from '@mantine/core';
import { Link } from 'react-router';
import { labels } from '../../i18n/pl.js';
import { usePushStatus } from './pushQueries.js';
import { isAndroid } from '../../platform.js';

export function NotificationBanner() {
  const { data } = usePushStatus();
  if (isAndroid() || !data?.hasReminders || (data.supported && data.permission === 'granted' && data.subscribed))
    return null;
  return (
    <Alert color="yellow">
      <Stack gap="xs">
        <Text>{labels.notificationsUi.banner}</Text>
        <Button component={Link} to="/wiecej/powiadomienia" variant="light" style={{ alignSelf: 'flex-start' }}>
          {labels.notificationsUi.title}
        </Button>
      </Stack>
    </Alert>
  );
}
