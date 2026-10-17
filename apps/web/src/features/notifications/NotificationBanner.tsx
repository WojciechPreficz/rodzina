import { Alert, Button, Stack, Text } from '@mantine/core';
import { Link } from 'react-router';
import { labels } from '../../i18n/pl.js';
import { usePushStatus } from './pushQueries.js';
import { isAndroid } from '../../platform.js';
import { useMe } from '../../auth.js';
import { useLocalSchedule } from './scheduleSync.js';

function AndroidBanner() {
  const { user } = useMe();
  const { data } = useLocalSchedule(user ? `${user.familyId}:${user.id}` : '');
  if (data?.result?.complete && !data.error) return null;
  return (
    <Alert color="yellow">
      <Stack gap="xs">
        <Text>{labels.localAlarms.banner}</Text>
        <Button component={Link} to="/wiecej/powiadomienia" variant="light" style={{ alignSelf: 'flex-start' }}>
          {labels.notificationsUi.title}
        </Button>
      </Stack>
    </Alert>
  );
}

export function NotificationBanner() {
  return isAndroid() ? <AndroidBanner /> : <WebBanner />;
}
function WebBanner() {
  const { data } = usePushStatus();
  if (!data?.hasReminders || (data.supported && data.permission === 'granted' && data.subscribed)) return null;
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
