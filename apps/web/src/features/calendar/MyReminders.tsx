import { Alert, Button, Loader } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CalendarEvent, CreateMyReminder } from '@rodzina/shared';
import { apiFetch } from '../../api.js';
import { useMe } from '../../auth.js';
import { labels } from '../../i18n/pl.js';
import { SYNC_INTERVAL_MS } from '../../queryClient.js';
import { ReminderList, ReminderPicker } from '../../components/ReminderPicker.js';
import { reminderInput } from '../../components/reminderFields.js';
import { refreshLocalSchedule } from '../notifications/scheduleSync.js';
import { calendarOnlineHint, useCalendarOnlineMutation, useCalendarReadOnly } from './calendarQueries.js';
import { isOffline, useOffline } from '../../connectivity.js';
import { fetchPersonal } from './calendarSync.js';
import { useCalendarSnapshot } from './calendarOffline.js';
import { EventSection } from './EventSection.js';
import './event.css';

const text = labels.calendarUi;
export function MyReminders({ event }: { event: CalendarEvent }) {
  const { user, family } = useMe();
  const client = useQueryClient();
  const readOnly = useCalendarReadOnly();
  const offline = useOffline();
  const snapshot = useCalendarSnapshot();
  const key = ['calendar', family?.id, user?.id, 'my-reminders', event.id];
  const query = useQuery({
    queryKey: key,
    queryFn: () => {
      if (readOnly || isOffline()) throw new Error(calendarOnlineHint);
      return fetchPersonal(event.id);
    },
    enabled: !readOnly,
    retry: false,
    refetchInterval: SYNC_INTERVAL_MS,
    refetchOnWindowFocus: 'always',
  });
  const sync = async () => {
    await refreshLocalSchedule(client);
    await client.invalidateQueries({ queryKey: key });
  };
  const create = useCalendarOnlineMutation(
    (data: CreateMyReminder) => apiFetch('/api/reminders/mine', { method: 'POST', body: JSON.stringify(data) }),
    sync,
  );
  const remove = useCalendarOnlineMutation(
    (id: string) => apiFetch(`/api/reminders/mine/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    sync,
  );
  const pending = create.isPending || remove.isPending;
  const reminders =
    snapshot.account === `${family?.id}:${user?.id}` ? (snapshot.personal[event.id] ?? query.data) : query.data;
  return (
    <EventSection title={text.myReminders}>
      {query.isPending && !offline && !reminders && <Loader aria-label={text.loading} />}
      {offline && !reminders && <Alert color="yellow">Osobiste przypomnienia nie zostały zapisane offline.</Alert>}
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
      {remove.error && (
        <Alert color="red" role="alert">
          {remove.error.message}
        </Alert>
      )}
      {reminders && (
        <ReminderList
          value={reminders.map((r) => ({ ...reminderInput(r), nextFireAt: r.nextFireAt }))}
          timezone={family?.timezone ?? 'Europe/Warsaw'}
          pending={pending || readOnly}
          onRemove={(index) => {
            void remove.mutateAsync(reminders[index]!.id).catch(() => {});
          }}
        />
      )}
      <ReminderPicker
        timezone={family?.timezone ?? 'Europe/Warsaw'}
        audiences={['user']}
        defaultAudience="user"
        pending={readOnly || pending || (!reminders && query.isPending) || Boolean(query.error)}
        onAdd={async (reminder) => {
          const data: CreateMyReminder =
            reminder.type === 'absolute'
              ? { eventId: event.id, type: 'absolute', remindAt: reminder.remindAt }
              : {
                  eventId: event.id,
                  type: 'offset',
                  offsetValue: reminder.offsetValue,
                  offsetUnit: reminder.offsetUnit,
                };
          await create.mutateAsync(data);
        }}
      />
    </EventSection>
  );
}
