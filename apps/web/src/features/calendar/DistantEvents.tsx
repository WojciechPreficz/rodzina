import { Alert, Button, Card, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router';
import { eventUrl } from '@rodzina/shared';
import { labels } from '../../i18n/pl.js';
import { useDistantEvents } from './calendarQueries.js';
import { todayInTimezone } from './toScheduleX.js';
import { distantCountdown } from './distantCountdown.js';
import { useOffline } from '../../connectivity.js';

export function DistantEvents({ timezone, selected }: { timezone: string; selected: string[] }) {
  const query = useDistantEvents();
  const offline = useOffline();
  const text = labels.calendarUi;
  const today = todayInTimezone(timezone);
  const events = query.data?.filter(
    (event) => !selected.length || event.participants.some((p) => selected.includes(p.id)),
  );
  return (
    <Stack className="calendar-distant" gap="sm" component="section" aria-label={text.distantTitle}>
      <Group justify="space-between">
        <Title order={2} size="md">
          {text.distantTitle}
        </Title>
        {events && (
          <Text size="sm" c="dimmed">
            {events.length}
          </Text>
        )}
      </Group>
      {query.isPending && !offline && !query.data && <Loader aria-label={text.loading} />}
      {offline && !query.data && <Text>Odległe terminy nie zostały zapisane offline.</Text>}
      {query.error && (
        <Alert color="red" role="alert">
          {query.error.message}
          <Button
            onClick={() => {
              void query.refetch();
            }}
          >
            {text.retry}
          </Button>
        </Alert>
      )}
      {events?.length === 0 && <Text c="dimmed">{text.noDistant}</Text>}
      {events?.map((event) => (
        <Card className="calendar-distant-card" key={event.id} withBorder component={Link} to={eventUrl(event.id)}>
          <span className="calendar-distant-icon" aria-hidden="true">
            ✧
          </span>
          <div className="calendar-distant-content">
            <Text fw={600} style={{ overflowWrap: 'anywhere' }}>
              {event.title}
            </Text>
            <Text size="sm" c="dimmed">
              {new Intl.DateTimeFormat('pl-PL', {
                timeZone: 'UTC',
                ...(event.datePrecision === 'month'
                  ? ({ month: 'long', year: 'numeric' } as const)
                  : ({ dateStyle: 'long' } as const)),
              }).format(new Date(`${event.startDate}T00:00:00Z`))}
            </Text>
          </div>
          <Text className="calendar-distant-countdown" size="sm" c="dimmed">
            {distantCountdown(event.startDate, today, event.datePrecision)}
          </Text>
          <span aria-hidden="true">›</span>
        </Card>
      ))}
    </Stack>
  );
}
