import { Alert, Button, Loader, Stack, Title } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CalendarEvent, CreateMyReminder, Reminder } from '@rodzina/shared';
import { apiFetch } from '../../api.js';
import { useMe } from '../../auth.js';
import { labels } from '../../i18n/pl.js';
import { SYNC_INTERVAL_MS } from '../../queryClient.js';
import { ReminderList, ReminderPicker } from '../../components/ReminderPicker.js';
import { reminderInput } from '../../components/reminderFields.js';

const text = labels.calendarUi;
export function MyReminders({ event }: { event: CalendarEvent }) {
  const { user, family } = useMe();
  const client = useQueryClient();
  const key = ['my-reminders', family?.id, user?.id, event.id];
  const query = useQuery({
    queryKey: key,
    queryFn: async () =>
      (await apiFetch<{ reminders: Reminder[] }>(`/api/reminders/mine?${new URLSearchParams({ eventId: event.id })}`))
        .reminders,
    refetchInterval: SYNC_INTERVAL_MS,
    refetchOnWindowFocus: 'always',
  });
  const sync = async () => {
    await client.invalidateQueries({ queryKey: key });
  };
  const create = useMutation({
    mutationFn: (data: CreateMyReminder) =>
      apiFetch('/api/reminders/mine', { method: 'POST', body: JSON.stringify(data) }),
    onSuccess: sync,
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/reminders/mine/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: sync,
  });
  const pending = create.isPending || remove.isPending;
  return (
    <Stack>
      <Title order={3}>{text.myReminders}</Title>
      {query.isPending && <Loader aria-label={text.loading} />}
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
      {query.data && (
        <ReminderList
          value={query.data.map((r) => ({ ...reminderInput(r), nextFireAt: r.nextFireAt }))}
          timezone={family?.timezone ?? 'Europe/Warsaw'}
          pending={pending}
          onRemove={(index) => {
            void remove.mutateAsync(query.data[index]!.id).catch(() => {});
          }}
        />
      )}
      <ReminderPicker
        timezone={family?.timezone ?? 'Europe/Warsaw'}
        audiences={['user']}
        defaultAudience="user"
        pending={pending || query.isPending || Boolean(query.error)}
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
    </Stack>
  );
}
