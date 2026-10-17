import { useState } from 'react';
import { Alert, Badge, Button, Group, Loader, Modal, Stack, Text, Title } from '@mantine/core';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  eventUrl,
  splitEventRule,
  wizardFromRrule,
  describeRecurrence,
  type EventScope,
  type EventPatch,
} from '@rodzina/shared';
import { Temporal } from 'temporal-polyfill';
import { ApiRequestError } from '../../api.js';
import { useMe } from '../../auth.js';
import { labels } from '../../i18n/pl.js';
import { useMembersQuery } from '../family/familyQueries.js';
import { EventForm } from './EventForm.js';
import { useCalendarMutations, useEvent } from './calendarQueries.js';
import { canEditEvent, getEventOccurrence } from './calendarRules.js';
import { ReminderList } from '../../components/ReminderPicker.js';
import { reminderInput } from '../../components/reminderFields.js';
import { MyReminders } from './MyReminders.js';
import { allowNavigation } from '../../nativeNavigation.js';
import { isAndroid } from '../../platform.js';
import { OfflineReminder } from '../notifications/OfflineReminder.js';

const text = labels.calendarUi;

export function EventDetailsPage() {
  const { eventId = '' } = useParams();
  const [search] = useSearchParams();
  const { user, family } = useMe();
  const query = useEvent(eventId);
  const members = useMembersQuery();
  const { update, remove } = useCalendarMutations();
  const [editing, setEditing] = useState(false);
  const [scope, setScope] = useState<EventScope['scope']>('all');
  const [scopeAction, setScopeAction] = useState<'edit' | 'delete' | null>(null);
  const navigate = useNavigate();
  const back = (
    <Button component={Link} to="/kalendarz" variant="light">
      {text.back}
    </Button>
  );
  if (!user || !family) return <Loader aria-label={text.loading} />;
  if (isAndroid() && (query.isPaused || (query.error && !(query.error instanceof ApiRequestError))))
    return <OfflineReminder />;
  if (query.isPending) return <Loader aria-label={text.loading} />;
  if (query.error)
    return (
      <Stack>
        {query.error instanceof ApiRequestError && [403, 404].includes(query.error.status) ? (
          <Text role="status">{query.error.status === 403 ? labels.androidNavigation.denied : text.missing}</Text>
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
  const wizard = event.rrule ? wizardFromRrule(event.rrule, event.startDate) : null;
  const localStart = Temporal.Instant.fromEpochMilliseconds(occurrence.startUtc).toZonedDateTimeISO(family.timezone);
  const formEvent =
    scope === 'this'
      ? {
          ...event,
          title,
          startDate: localStart.toPlainDate().toString(),
          startTime: occurrence.allDay ? null : localStart.toPlainTime().toString().slice(0, 5),
          durationMinutes: occurrence.allDay ? null : (occurrence.endUtc - occurrence.startUtc) / 60000,
        }
      : scope === 'following'
        ? {
            ...event,
            startDate: occurrence.occurrenceDate,
            rrule: splitEventRule(event, occurrence.occurrenceDate).following,
          }
        : event;

  async function deleteWithScope(selectedScope: EventScope['scope']) {
    if (
      !window.confirm(
        event.kind === 'recurring'
          ? `${text.deleteSeriesConfirm} ${text.scopeNames[selectedScope]}?`
          : text.deleteConfirm,
      )
    )
      return;
    try {
      await remove.mutateAsync({
        id: event.id,
        scope:
          selectedScope === 'all'
            ? { scope: selectedScope }
            : { scope: selectedScope, occurrenceDate: occurrence!.occurrenceDate },
      });
      setScopeAction(null);
      navigate('/kalendarz');
    } catch {
      /* The mutation exposes the error above. */
    }
  }
  return (
    <Stack>
      {back}
      <Title order={2}>{title}</Title>
      {wizard && <Text c="dimmed">{describeRecurrence(wizard)}</Text>}
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
      <Title order={3}>{text.reminders}</Title>
      <ReminderList
        value={event.reminders.map((r) => ({ ...reminderInput(r), nextFireAt: r.nextFireAt }))}
        timezone={family.timezone}
      />
      <MyReminders key={event.id} event={event} />
      {editable && (
        <>
          {remove.error && (
            <Alert color="red" role="alert">
              {remove.error.message}
            </Alert>
          )}
          <Group>
            <Button
              onClick={() => {
                if (event.kind === 'recurring') setScopeAction('edit');
                else {
                  setScope('all');
                  setEditing(true);
                }
              }}
              disabled={!members.data}
            >
              {labels.edit}
            </Button>
            <Button
              color="red"
              variant="light"
              loading={remove.isPending}
              onClick={() => {
                if (event.kind === 'recurring') setScopeAction('delete');
                else void deleteWithScope('all');
              }}
            >
              {text.delete}
            </Button>
          </Group>
          {members.error && <Alert color="red">{members.error.message}</Alert>}
          <Modal
            opened={scopeAction !== null}
            onClose={() => {
              if (!remove.isPending) setScopeAction(null);
            }}
            title={scopeAction === 'edit' ? text.editScope : text.deleteScope}
          >
            <Stack>
              <Text>
                {text.scopeDate}: {occurrence.occurrenceDate}
              </Text>
              {remove.error && (
                <Alert color="red" role="alert">
                  {remove.error.message}
                </Alert>
              )}
              {(['this', 'following', 'all'] as const).map((option) => (
                <Button
                  key={option}
                  variant="light"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (scopeAction === 'delete') void deleteWithScope(option);
                    else {
                      setScope(option);
                      setScopeAction(null);
                      setEditing(true);
                    }
                  }}
                >
                  {text.scopeNames[option]}
                </Button>
              ))}
            </Stack>
          </Modal>
          <Modal
            opened={editing}
            onClose={() => {
              if (allowNavigation()) setEditing(false);
            }}
            title={text.editEvent}
          >
            <EventForm
              key={`${event.id}:${event.updatedAt}:${scope}:${occurrence.occurrenceDate}`}
              event={formEvent}
              occurrenceOnly={scope === 'this'}
              members={members.data ?? []}
              initialDate={event.startDate}
              pending={update.isPending}
              onCancel={() => {
                if (allowNavigation()) setEditing(false);
              }}
              onSave={async (data) => {
                const patch: EventPatch =
                  scope === 'this'
                    ? {
                        title: data.title,
                        startDate: data.startDate,
                        startTime: data.startTime,
                        durationMinutes: data.durationMinutes,
                      }
                    : data;
                // Let the API retain remaining COUNT and future exceptions when the pattern is unchanged.
                if (scope === 'following' && patch.rrule === formEvent.rrule) delete patch.rrule;
                const saved = await update.mutateAsync({
                  id: event.id,
                  data: patch,
                  scope: scope === 'all' ? { scope } : { scope, occurrenceDate: occurrence.occurrenceDate },
                });
                setEditing(false);
                navigate(eventUrl(saved.id, scope === 'this' ? occurrence.occurrenceDate : undefined));
              }}
            />
          </Modal>
        </>
      )}
    </Stack>
  );
}
