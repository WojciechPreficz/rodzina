import { Alert, Button, Loader, Stack, Text, Title } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateMyReminder, Reminder } from '@rodzina/shared';
import { apiFetch } from '../../api.js';
import { useMe } from '../../auth.js';
import { isOffline, useOffline } from '../../connectivity.js';
import { ReminderList, ReminderPicker } from '../../components/ReminderPicker.js';
import { reminderInput } from '../../components/reminderFields.js';
import { SYNC_INTERVAL_MS } from '../../queryClient.js';
import { refreshLocalSchedule } from '../notifications/scheduleSync.js';

export function DocumentReminders({ documentId, timezone }: { documentId: string; timezone: string }) {
  const { user, family, familyConfirmed } = useMe();
  const offline = useOffline();
  const client = useQueryClient();
  const online = !!user && !!family && familyConfirmed && !offline;
  const key = ['document-reminders', family?.id, user?.id, documentId];
  const query = useQuery({
    queryKey: key,
    enabled: online,
    queryFn: async ({ signal }) =>
      (
        await apiFetch<{ reminders: Reminder[] }>(`/api/reminders/mine?${new URLSearchParams({ documentId })}`, {
          signal,
        })
      ).reminders,
    refetchInterval: SYNC_INTERVAL_MS,
  });
  const sync = async () => {
    await Promise.all([client.invalidateQueries({ queryKey: key }), refreshLocalSchedule(client)]);
  };
  const checkOnline = () => {
    if (!online || isOffline()) throw new Error('Połącz się z internetem, aby zmienić przypomnienia.');
  };
  const create = useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: (data: CreateMyReminder) => {
      checkOnline();
      return apiFetch('/api/reminders/mine', { method: 'POST', body: JSON.stringify(data) });
    },
    onSuccess: sync,
  });
  const remove = useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: (id: string) => {
      checkOnline();
      return apiFetch(`/api/reminders/mine/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    onSuccess: sync,
  });
  const pending = !online || create.isPending || remove.isPending;
  return (
    <Stack component="section" aria-label="Moje przypomnienia">
      <Title order={2}>Moje przypomnienia</Title>
      <Text size="sm">
        Tylko Ty otrzymasz te przypomnienia. Alarmy przed terminem działają w APK o 09:00 ({timezone}).
      </Text>
      {query.isPending && online && <Loader aria-label="Ładowanie przypomnień" />}
      {query.error && (
        <Alert color="red" role="alert">
          {query.error.message}{' '}
          <Button variant="subtle" onClick={() => void query.refetch()}>
            Spróbuj ponownie
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
          document
          value={query.data.map((item) => ({ ...reminderInput(item), nextFireAt: item.nextFireAt }))}
          timezone={timezone}
          pending={pending}
          onRemove={(index) => remove.mutate(query.data![index]!.id)}
        />
      )}
      <ReminderPicker
        document
        audiences={['user']}
        defaultAudience="user"
        timezone={timezone}
        pending={pending || !query.isSuccess}
        onAdd={async (reminder) => {
          const data: CreateMyReminder =
            reminder.type === 'absolute'
              ? { documentId, type: 'absolute', remindAt: reminder.remindAt }
              : { documentId, type: 'offset', offsetValue: reminder.offsetValue, offsetUnit: reminder.offsetUnit };
          await create.mutateAsync(data);
        }}
      />
    </Stack>
  );
}
