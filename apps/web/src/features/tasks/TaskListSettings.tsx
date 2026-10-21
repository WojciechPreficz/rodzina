import { Alert, Button, Group, MultiSelect, Stack, Text, TextInput } from '@mantine/core';
import type { PatchTaskList, TaskList } from '@rodzina/shared';
import { useState } from 'react';
import { labels } from '../../i18n/pl.js';
import { useFormNavigation } from '../../useFormNavigation.js';
import type { Member } from '@rodzina/shared';

const t = labels.tasksUi;
export function TaskListSettings({
  list,
  members,
  pending,
  error,
  onSave,
  onDelete,
  onCancel,
}: {
  list: TaskList;
  members: Member[];
  pending: boolean;
  error: string | undefined;
  onSave: (data: PatchTaskList) => Promise<void>;
  onDelete: () => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(list.name);
  const [memberIds, setMemberIds] = useState(list.memberIds);
  const navigation = useFormNavigation();
  return (
    <form
      data-navigation-guard="true"
      onChange={navigation.changed}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || !name.trim()) return;
        void onSave({ name: name.trim(), memberIds })
          .then(() => {
            navigation.saved();
            onCancel();
          })
          .catch(() => {});
      }}
    >
      <Stack>
        {error && <Alert color="red">{error}</Alert>}
        <TextInput
          label={t.listName}
          value={name}
          maxLength={200}
          required
          disabled={pending}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <MultiSelect
          label={t.shareWith}
          placeholder={t.sharePlaceholder}
          searchable
          clearable
          clearButtonProps={{ 'aria-label': t.clearSharing, 'aria-hidden': false, tabIndex: 0 }}
          value={memberIds}
          disabled={pending}
          data={members
            .filter((member) => member.id !== list.ownerId)
            .map((member) => ({ value: member.id, label: member.displayName }))}
          onChange={(value) => {
            navigation.changed();
            setMemberIds(value);
          }}
        />
        <Group justify="flex-end">
          <Button variant="default" disabled={pending} onClick={onCancel}>
            {t.cancel}
          </Button>
          <Button type="submit" loading={pending}>
            {t.save}
          </Button>
        </Group>
        {list.isDefault ? (
          <Text size="sm" c="dimmed">
            {t.defaultListHint}
          </Text>
        ) : (
          <Button
            color="red"
            variant="subtle"
            disabled={pending}
            onClick={() => {
              if (window.confirm(t.deleteListConfirm)) void onDelete().catch(() => {});
            }}
          >
            {t.deleteList}
          </Button>
        )}
      </Stack>
    </form>
  );
}
