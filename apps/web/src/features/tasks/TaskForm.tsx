import { Alert, Button, Group, Select, Stack, Textarea, TextInput } from '@mantine/core';
import { createTaskSchema, type CreateTask, type Task } from '@rodzina/shared';
import { useState, type FormEvent } from 'react';
import { labels } from '../../i18n/pl.js';
import { useFormNavigation } from '../../useFormNavigation.js';
import type { Member } from '../family/familyApi.js';

const t = labels.tasksUi;

export function TaskForm({
  task,
  members,
  onSave,
  onCancel,
  pending,
  error,
}: {
  task?: Task | undefined;
  members: Member[];
  onSave: (data: CreateTask) => Promise<void>;
  onCancel: () => void;
  pending: boolean;
  error?: string | undefined;
}) {
  const navigation = useFormNavigation();
  const [title, setTitle] = useState(task?.title ?? '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [dueTime, setDueTime] = useState(task?.dueTime ?? '');
  const [assigneeId, setAssigneeId] = useState<string | null>(task?.assigneeId ?? null);
  const [invalid, setInvalid] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const result = createTaskSchema.safeParse({
      title,
      notes: notes.trim() || null,
      dueDate: dueDate || null,
      dueTime: dueDate && dueTime ? dueTime : null,
      assigneeId,
    });
    setInvalid(!result.success);
    if (!result.success) return;
    try {
      await onSave(result.data);
      navigation.saved();
      onCancel();
    } catch {
      // The mutation error is rendered by the parent; keep the entered values.
    }
  };
  return (
    <form data-navigation-guard="true" onChange={navigation.changed} onSubmit={(event) => void submit(event)}>
      <Stack>
        {error && <Alert color="red">{error}</Alert>}
        {invalid && <Alert color="red">{t.invalid}</Alert>}
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
        <Select
          label={t.assignee}
          placeholder={t.unassigned}
          clearable
          value={assigneeId}
          disabled={pending}
          data={members.map((member) => ({ value: member.id, label: member.displayName }))}
          onChange={(value) => {
            navigation.changed();
            setAssigneeId(value);
          }}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onCancel} disabled={pending}>
            {t.cancel}
          </Button>
          <Button type="submit" loading={pending}>
            {t.save}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
