import { useState } from 'react';
import { Alert, Badge, Button, Group, Loader, Modal, Stack, Text, Title } from '@mantine/core';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { eventUrl } from '@rodzina/shared';
import { ApiRequestError } from '../../api.js';
import { useMe } from '../../auth.js';
import { labels } from '../../i18n/pl.js';
import { useMembersQuery } from '../family/familyQueries.js';
import { EventForm } from './EventForm.js';
import { useCalendarMutations, useEvent } from './calendarQueries.js';
import { canEditEvent, getEventOccurrence } from './calendarRules.js';

const text = labels.calendarUi;

export function EventDetailsPage() {
  const { eventId = '' } = useParams();
  const [search] = useSearchParams();
  const { user, family } = useMe();
  const query = useEvent(eventId);
  const members = useMembersQuery();
  const { update, remove } = useCalendarMutations();
  const [editing, setEditing] = useState(false);
  const navigate = useNavigate();
  const back = (
    <Button component={Link} to="/kalendarz" variant="light">
      {text.back}
    </Button>
  );
  if (!user || !family || query.isPending) return <Loader aria-label={text.loading} />;
  if (query.error)
    return (
      <Stack>
        {query.error instanceof ApiRequestError && query.error.status === 404 ? (
          <Text role="status">{text.missing}</Text>
        ) : (
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
        {back}
      </Stack>
    );
  const event = query.data;
  const occurrence = getEventOccurrence(event, search.get('data'), family.timezone);
  if (!occurrence)
    return (
      <Stack>
        <Text role="status">{text.missing}</Text>
        {back}
      </Stack>
    );
  const exception = event.exceptions.find((item) => item.originalDate === occurrence.occurrenceDate);
  const title = exception?.overrideTitle ?? event.title;
  const editable = canEditEvent(user, event);
  const author = members.data?.find((member) => member.id === event.createdBy)?.displayName;
  const dateLabel = new Intl.DateTimeFormat('pl-PL', {
    timeZone: family.timezone,
    ...(event.datePrecision === 'month'
      ? { month: 'long' as const, year: 'numeric' as const }
      : { dateStyle: 'long' as const }),
    ...(occurrence.allDay ? {} : { timeStyle: 'short' as const }),
  }).format(occurrence.startUtc);
  return (
    <Stack>
      {back}
      <Title order={2}>{title}</Title>
      <Text>
        {dateLabel}
        {occurrence.allDay ? ` · ${text.allDay}` : ''}
      </Text>
      {!occurrence.allDay && (
        <Text>
          {text.duration}: {(occurrence.endUtc - occurrence.startUtc) / 60000}
        </Text>
      )}
      {event.description && (
        <Text style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{event.description}</Text>
      )}
      {event.location && (
        <Text>
          {text.location}: {event.location}
        </Text>
      )}
      <Text>
        {text.author}: {event.createdBy === null ? text.formerMember : (author ?? '…')}
      </Text>
      <Group>
        {event.participants.length ? (
          event.participants.map((participant) => (
            <Badge key={participant.id} color={participant.color}>
              {participant.displayName}
            </Badge>
          ))
        ) : (
          <Text c="dimmed">{text.noParticipants}</Text>
        )}
      </Group>
      {editable && (
        <>
          {event.kind === 'recurring' && <Alert>{text.seriesNotice}</Alert>}
          {remove.error && (
            <Alert color="red" role="alert">
              {remove.error.message}
            </Alert>
          )}
          <Group>
            <Button onClick={() => setEditing(true)} disabled={!members.data}>
              {labels.edit}
            </Button>
            <Button
              color="red"
              variant="light"
              loading={remove.isPending}
              onClick={async () => {
                if (!window.confirm(text.deleteConfirm)) return;
                try {
                  await remove.mutateAsync(event.id);
                  navigate('/kalendarz');
                } catch {
                  /* The mutation exposes the error above. */
                }
              }}
            >
              {text.delete}
            </Button>
          </Group>
          {members.error && <Alert color="red">{members.error.message}</Alert>}
          <Modal opened={editing} onClose={() => setEditing(false)} title={text.editEvent}>
            <EventForm
              key={`${event.id}:${event.updatedAt}`}
              event={event}
              members={members.data ?? []}
              initialDate={event.startDate}
              pending={update.isPending}
              onCancel={() => setEditing(false)}
              onSave={async (data) => {
                const saved = await update.mutateAsync({ id: event.id, data });
                setEditing(false);
                navigate(eventUrl(saved.id, saved.startDate));
              }}
            />
          </Modal>
        </>
      )}
    </Stack>
  );
}
