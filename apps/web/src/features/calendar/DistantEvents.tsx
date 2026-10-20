import { Alert, Button, Card, Loader, Stack, Text, Title } from '@mantine/core';
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
    <Stack>
      <Title order={3}>{text.distantTitle}</Title>
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
        <Card key={event.id} withBorder component={Link} to={eventUrl(event.id)}>
          <Text fw={600} style={{ overflowWrap: 'anywhere' }}>
            {event.title}
          </Text>
          <Text>
            {new Intl.DateTimeFormat('pl-PL', {
              timeZone: 'UTC',
              ...(event.datePrecision === 'month'
                ? ({ month: 'long', year: 'numeric' } as const)
                : ({ dateStyle: 'long' } as const)),
            }).format(new Date(`${event.startDate}T00:00:00Z`))}
          </Text>
          <Text size="sm" c="dimmed">
            {distantCountdown(event.startDate, today, event.datePrecision)}
          </Text>
        </Card>
      ))}
    </Stack>
  );
}
