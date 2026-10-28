import { useEffect, useState } from 'react';
import { Alert, Button, Loader, Stack, Text, Title } from '@mantine/core';
import { Link, useLocation } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { reminderScheduleSchema, type ReminderSchedule } from '@rodzina/shared';
import { alarmStore } from './localSchedule.js';
import { useMe } from '../../sessionContext.js';
import { isAndroid } from '../../platform.js';
import { notificationPath } from '../../nativeNavigation.js';
import { labels } from '../../i18n/pl.js';

const text = labels.androidNavigation;
export function OfflineReminder() {
  const location = useLocation();
  const url = location.pathname + location.search;
  const { refresh } = useMe();
  const client = useQueryClient();
  const [items, setItems] = useState<ReminderSchedule['reminders'] | null>(null);
  useEffect(() => {
    let disposed = false;
    setItems(null);
    const read = async () => {
      try {
        const { value } = await alarmStore.preview();
        const snapshot = value ? reminderScheduleSchema.parse(JSON.parse(value).snapshot) : null;
        if (!disposed) setItems(snapshot?.reminders.filter((item) => notificationPath(item.url) === url) ?? []);
      } catch {
        if (!disposed) setItems([]);
      }
    };
    if (isAndroid() && notificationPath(url)) void read();
    else setItems([]);
    return () => {
      disposed = true;
    };
  }, [url]);
  if (items === null) return <Loader />;
  return (
    <Stack>
      <Title order={2}>{text.offline}</Title>
      <Alert color="yellow">{text.stale}</Alert>
      {items.length ? (
        items.map((item) => (
          <Stack key={item.key} gap="xs">
            <Title order={3}>{item.title}</Title>
            <Text style={{ whiteSpace: 'pre-wrap' }}>{item.body}</Text>
          </Stack>
        ))
      ) : (
        <Text role="status">{text.unavailable}</Text>
      )}
      <Button
        onClick={async () => {
          await refresh();
          await Promise.all([
            client.invalidateQueries({ queryKey: ['calendar'] }),
            client.invalidateQueries({ queryKey: ['documents'] }),
          ]);
        }}
      >
        {text.refresh}
      </Button>
      <Button component={Link} variant="light" to={`/login?next=${encodeURIComponent(url)}`}>
        {text.login}
      </Button>
      <Button component={Link} variant="subtle" to="/kalendarz">
        {labels.calendarUi.back}
      </Button>
    </Stack>
  );
}
