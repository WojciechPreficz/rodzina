import { Alert, Button, Stack, Text } from '@mantine/core';
import { Link } from 'react-router';
import { labels } from '../../i18n/pl.js';
import { isAndroid } from '../../platform.js';
import { useMe } from '../../auth.js';
import { useLocalSchedule } from './scheduleSync.js';

function AndroidBanner() {
  const { user } = useMe();
  const { data } = useLocalSchedule(user ? `${user.familyId}:${user.id}` : '');
  if (data?.result?.complete && !data.error) return null;
  const issue = data?.result?.issues?.[0];
  const message = data?.error
    ? labels.localAlarms.syncFailed
    : issue
      ? labels.localAlarms.issues[issue]
      : labels.localAlarms.banner;
  return (
    <Alert color="yellow">
      <Stack gap="xs">
        <Text>{message}</Text>
        <Button component={Link} to="/wiecej/powiadomienia" variant="light" style={{ alignSelf: 'flex-start' }}>
          {labels.notificationsUi.title}
        </Button>
      </Stack>
    </Alert>
  );
}

export function NotificationBanner() {
  return isAndroid() ? <AndroidBanner /> : null;
}
