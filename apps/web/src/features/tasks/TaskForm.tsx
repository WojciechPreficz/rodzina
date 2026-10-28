import {
  Alert,
  Button,
  Group,
  Loader,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import {
  createTaskSchema,
  sharedTaskReminderSchema,
  type CreateTask,
  type PatchTask,
  type Reminder,
  type Task,
} from '@rodzina/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { apiFetch } from '../../api.js';
import { useMe } from '../../sessionContext.js';
import { isOffline, useOffline } from '../../connectivity.js';
import { ReminderList, ReminderPicker } from '../../components/ReminderPicker.js';
import { reminderInput, type ReminderInput, type ReminderItem } from '../../components/reminderFields.js';
import { refreshLocalSchedule } from '../notifications/scheduleSync.js';
import { labels } from '../../i18n/pl.js';
import { useFormNavigation } from '../../useFormNavigation.js';
import { taskOfflineText } from './taskOffline.js';
import type { Member } from '@rodzina/shared';
import './tasks.css';

const t = labels.tasksUi;

type TaskFormProps = {
  task?: Task | undefined;
  members: Member[];
  shared: boolean;
  onSave: (data: CreateTask, id?: string, changes?: PatchTask) => Promise<Task>;
  onCancel: () => void;
  pending: boolean;
  error?: string | undefined;
};

export function TaskForm(props: TaskFormProps) {
  const { user, family } = useMe();
  const offline = useOffline();
  const openedOffline = useRef(offline).current;
  const personal = useQuery({
    queryKey: ['tasks', family?.id, user?.id, 'my-reminders', props.task?.id],
    queryFn: async ({ signal }) =>
      (
        await apiFetch<{ reminders: Reminder[] }>(`/api/reminders/mine?taskId=${encodeURIComponent(props.task!.id)}`, {
          signal,
        })
      ).reminders,
    enabled: !!props.task && !offline && !openedOffline,
    staleTime: 0,
    retry: false,
  });
  if (!offline && !openedOffline && props.task && personal.isError)
    return (
      <Alert color="red">
        {personal.error.message}
        <Button onClick={() => void personal.refetch()}>{t.retry}</Button>
      </Alert>
    );
  if (!offline && !openedOffline && props.task && !personal.isFetchedAfterMount)
    return <Loader aria-label={t.loading} />;
  return <TaskEditor {...props} personal={personal.data ?? []} openedOffline={openedOffline} />;
}

function TaskEditor({
  task,
  personal,
  shared,
  members,
  onSave,
  onCancel,
  pending,
  error,
  openedOffline,
}: TaskFormProps & { personal: Reminder[]; openedOffline: boolean }) {
  const { family, user } = useMe();
  const offline = useOffline();
  const configurationOffline = offline || openedOffline;
  const client = useQueryClient();
  const navigation = useFormNavigation();
  const savedId = useRef(task?.id);
  const baseline = useRef(task);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [reminders, setReminders] = useState<(ReminderItem & { id?: string })[]>(() =>
    [...(task?.reminders ?? []), ...personal].map((reminder) => ({
      ...reminderInput(reminder),
      id: reminder.id,
      nextFireAt: reminder.nextFireAt,
    })),
  );
  const [sharedChanged, setSharedChanged] = useState(false);
  const storedPersonal = useRef(personal.map((reminder) => ({ id: reminder.id, input: reminderInput(reminder) })));
  const [title, setTitle] = useState(task?.title ?? '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [dueTime, setDueTime] = useState(task?.dueTime ?? '');
  const [assigneeId, setAssigneeId] = useState<string | null>(task?.assigneeId ?? null);
  const [invalid, setInvalid] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || saving) return;
    setSaveError(undefined);
    if (!dueDate && reminders.some((reminder) => !reminder.id || (sharedChanged && reminder.audience !== 'user'))) {
      setSaveError(t.reminderNeedsDate);
      return;
    }
    const result = createTaskSchema.safeParse({
      title,
      notes: notes.trim() || null,
      dueDate: dueDate || null,
      dueTime: dueDate && dueTime ? dueTime : null,
      assigneeId,
      ...(sharedChanged
        ? {
            reminders: reminders
              .filter((reminder) => reminder.audience !== 'user')
              .map((reminder) => sharedTaskReminderSchema.parse(reminderInputForSave(reminder))),
          }
        : {}),
    });
    setInvalid(!result.success);
    if (!result.success) return;
    if (
      isOffline() &&
      (sharedChanged ||
        reminders.some((reminder) => !reminder.id) ||
        storedPersonal.current.some((stored) => !reminders.some((reminder) => reminder.id === stored.id)))
    ) {
      setSaveError(taskOfflineText.limits);
      return;
    }
    setSaving(true);
    try {
      const changes = Object.fromEntries(
        Object.entries(result.data).filter(
          ([field, value]) =>
            field === 'reminders' || JSON.stringify(baseline.current?.[field as keyof Task]) !== JSON.stringify(value),
        ),
      ) as PatchTask;
      const saved = await onSave(result.data, savedId.current, changes);
      savedId.current = saved.id;
      baseline.current = saved;
      try {
        for (const stored of [...storedPersonal.current]) {
          if (reminders.some((reminder) => reminder.id === stored.id)) continue;
          if (isOffline()) throw new Error(t.offline);
          await apiFetch(`/api/reminders/mine/${encodeURIComponent(stored.id)}`, { method: 'DELETE' });
          storedPersonal.current = storedPersonal.current.filter((item) => item.id !== stored.id);
        }
        const desired = reminders.filter((reminder) => reminder.audience === 'user');
        for (const reminder of desired) {
          const input = reminderInputForSave(reminder);
          if (storedPersonal.current.some((stored) => JSON.stringify(stored.input) === JSON.stringify(input))) continue;
          if (isOffline()) throw new Error(t.offline);
          const time =
            input.type === 'absolute'
              ? { type: input.type, remindAt: input.remindAt }
              : { type: input.type, offsetValue: input.offsetValue, offsetUnit: input.offsetUnit };
          const response = await apiFetch<{ reminder: Reminder }>('/api/reminders/mine', {
            method: 'POST',
            body: JSON.stringify({ taskId: saved.id, ...time }),
          });
          storedPersonal.current.push({ id: response.reminder.id, input });
          setReminders((current) =>
            current.map((item) => (item === reminder ? { ...item, id: response.reminder.id } : item)),
          );
        }
      } catch (cause) {
        throw new Error(`${t.reminderSaveFailed} ${cause instanceof Error ? cause.message : ''}`);
      } finally {
        if (!isOffline())
          await Promise.all([
            client.invalidateQueries({ queryKey: ['tasks', family?.id, user?.id] }),
            refreshLocalSchedule(client),
          ]);
      }
      navigation.saved();
      onCancel();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : t.failed);
    } finally {
      setSaving(false);
    }
  };
  return (
    <form data-navigation-guard="true" onChange={navigation.changed} onSubmit={(event) => void submit(event)}>
      <fieldset disabled={pending || saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <Stack>
          {configurationOffline && (
            <Alert>
              {taskOfflineText.limits}
              {!offline && ' Zamknij i otwórz formularz ponownie, aby pobrać aktualną konfigurację.'}
            </Alert>
          )}
          {(saveError || error) && <Alert color="red">{saveError || error}</Alert>}
          {invalid && <Alert color="red">{t.invalid}</Alert>}
          <div className="task-form-grid">
            <Stack gap="md">
              <Paper component="section" withBorder className="task-form-section" aria-label={t.details}>
                <Stack>
                  <Text fw={600}>{t.details}</Text>
                  <TextInput
                    label={t.name}
                    value={title}
                    onChange={(event) => setTitle(event.currentTarget.value)}
                    required
                    maxLength={200}
                    disabled={pending}
                    data-autofocus
                  />
                  <Textarea
                    label={t.notes}
                    value={notes}
                    onChange={(event) => setNotes(event.currentTarget.value)}
                    maxLength={10000}
                    autosize
                    minRows={3}
                    disabled={pending}
                  />
                </Stack>
              </Paper>
              <Paper component="section" withBorder className="task-form-section" aria-label={t.planning}>
                <Stack>
                  <Text fw={600}>{t.planning}</Text>
                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    <TextInput
                      type="date"
                      label={t.dueDate}
                      value={dueDate}
                      disabled={pending}
                      onChange={(event) => {
                        setDueDate(event.currentTarget.value);
                        if (!event.currentTarget.value) setDueTime('');
                      }}
                    />
                    <TextInput
                      type="time"
                      label={t.dueTime}
                      value={dueTime}
                      disabled={pending || !dueDate}
                      onChange={(event) => setDueTime(event.currentTarget.value)}
                    />
                  </SimpleGrid>
                  <Select
                    label={t.assignee}
                    placeholder={t.unassigned}
                    clearable
                    value={assigneeId}
                    disabled={pending || configurationOffline}
                    data={members.map((member) => ({ value: member.id, label: member.displayName }))}
                    onChange={(value) => {
                      navigation.changed();
                      setAssigneeId(value);
                    }}
                  />
                </Stack>
              </Paper>
            </Stack>
            <Paper component="section" withBorder className="task-form-section task-reminders" aria-label={t.reminders}>
              <Stack>
                <Text fw={600}>{t.reminders}</Text>
                <Text size="sm" c="dimmed">
                  {t.reminderHint}
                </Text>
                <ReminderList
                  task
                  value={reminders}
                  timezone={family!.timezone}
                  pending={pending || saving || configurationOffline}
                  onRemove={(index) => {
                    navigation.changed();
                    if (reminders[index]!.audience !== 'user') setSharedChanged(true);
                    setReminders((current) => current.filter((_, position) => position !== index));
                  }}
                />
                {!dueDate && (
                  <Text size="sm" c="dimmed">
                    {t.reminderNeedsDate}
                  </Text>
                )}
                <ReminderPicker
                  task
                  timezone={family!.timezone}
                  audiences={shared ? ['owner', 'list_members', 'user'] : ['owner', 'user']}
                  defaultAudience="owner"
                  pending={!dueDate || pending || saving || configurationOffline}
                  onAdd={(reminder) => {
                    if (!dueDate) throw new Error(t.reminderNeedsDate);
                    if (reminders.length >= 20) throw new Error(t.reminderLimit);
                    if (
                      reminders.some(
                        (item) =>
                          JSON.stringify(reminderInputForSave(item)) === JSON.stringify(reminderInputForSave(reminder)),
                      )
                    )
                      return;
                    navigation.changed();
                    if (reminder.audience !== 'user') setSharedChanged(true);
                    setReminders((current) => [...current, reminder]);
                  }}
                />
              </Stack>
            </Paper>
          </div>
          <Group justify="flex-end">
            <Button variant="default" onClick={onCancel} disabled={pending}>
              {t.cancel}
            </Button>
            <Button type="submit" loading={pending || saving}>
              {t.save}
            </Button>
          </Group>
        </Stack>
      </fieldset>
    </form>
  );
}

function reminderInputForSave(reminder: ReminderInput): ReminderInput {
  return reminder.type === 'absolute'
    ? { type: 'absolute', remindAt: reminder.remindAt, audience: reminder.audience }
    : {
        type: 'offset',
        offsetValue: reminder.offsetValue,
        offsetUnit: reminder.offsetUnit,
        audience: reminder.audience,
      };
}
