import { Alert, Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import type { Member, Task } from '@rodzina/shared';
import { labels } from '../../i18n/pl.js';
import { TaskForm } from './TaskForm.js';
import { TaskListSettings } from './TaskListSettings.js';
import type { useTasks } from './taskQueries.js';
import type { useTaskActions } from './useTaskActions.js';

const t = labels.tasksUi;

export function TaskListDialogs({
  data,
  actions,
  canManageList,
  members,
  membersPending,
  membersError,
  listMembers,
  editedTask,
}: {
  data: Pick<
    ReturnType<typeof useTasks>,
    | 'active'
    | 'offline'
    | 'clearDone'
    | 'createList'
    | 'updateList'
    | 'removeList'
    | 'checklist'
    | 'reviewOperations'
    | 'pendingCount'
    | 'create'
    | 'update'
    | 'remove'
  >;
  actions: ReturnType<typeof useTaskActions>;
  canManageList: boolean;
  members: Member[];
  membersPending: boolean;
  membersError: string | undefined;
  listMembers: Member[];
  editedTask: Task | undefined;
}) {
  const { active } = data;
  return (
    <>
      <Modal opened={actions.clearingDone} onClose={actions.closeClearDone} title={t.clearDone}>
        <Stack>
          <Text>{t.clearDoneConfirm}</Text>
          {data.clearDone.error && <Alert color="red">{data.clearDone.error.message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" disabled={data.clearDone.isPending} onClick={actions.closeClearDone}>
              {t.cancel}
            </Button>
            <Button color="red.9" loading={data.clearDone.isPending} onClick={actions.clearDone}>
              {t.clearDoneRemove}
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal opened={actions.addingList && !data.offline} onClose={actions.closeAddList} title={t.addList}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            actions.createList();
          }}
        >
          <Stack>
            {data.createList.error && <Alert color="red">{data.createList.error.message}</Alert>}
            <TextInput
              label={t.listName}
              value={actions.listName}
              onChange={(event) => actions.setListName(event.currentTarget.value)}
              maxLength={200}
              required
              data-autofocus
              disabled={data.createList.isPending}
            />
            <Button type="submit" loading={data.createList.isPending}>
              {t.add}
            </Button>
          </Stack>
        </form>
      </Modal>
      <Modal
        opened={!data.offline && actions.settingsOpened && canManageList}
        onClose={actions.closeSettings}
        title={t.settings}
        size="lg"
      >
        {actions.settingsOpened && active && canManageList && (
          <TaskListSettings
            key={active.id}
            list={active}
            members={members}
            pending={data.updateList.isPending || data.removeList.isPending || membersPending}
            error={data.updateList.error?.message ?? data.removeList.error?.message ?? membersError}
            onSave={actions.saveList}
            onDelete={actions.deleteList}
            onCancel={actions.closeSettings}
          />
        )}
      </Modal>
      <Modal
        opened={!!active && (actions.addingTask || !!editedTask)}
        onClose={actions.closeTask}
        title={editedTask ? t.editTask : t.addTask}
        size="xl"
      >
        {(actions.addingTask || editedTask) && active && (
          <TaskForm
            key={`${active.id}:${editedTask?.id ?? 'new'}`}
            task={editedTask}
            onChecklistChange={editedTask ? (change) => actions.changeChecklist(editedTask.id, change) : undefined}
            checklistPending={data.checklist.isPending}
            checklistStatus={
              editedTask && data.reviewOperations.some((op) => op.taskId === editedTask.id)
                ? 'Zmiany tego zadania wymagają sprawdzenia. Zamknij formularz i wybierz „Sprawdź zmiany” na liście.'
                : data.pendingCount > 0
                  ? `Zmiany oczekujące na wysłanie: ${data.pendingCount}`
                  : undefined
            }
            onToggleDone={editedTask ? () => actions.toggleDone(editedTask, !editedTask.isDone) : undefined}
            members={listMembers}
            shared={active.memberIds.length > 0}
            pending={data.create.isPending || data.update.isPending || data.remove.isPending}
            error={(editedTask ? data.update.error : data.create.error)?.message}
            onCancel={actions.closeTask}
            onSave={actions.saveTask}
          />
        )}
        {editedTask && (
          <Button
            mt="md"
            color="red.9"
            variant="subtle"
            disabled={data.remove.isPending || data.update.isPending}
            onClick={() => actions.deleteTask(editedTask.id)}
          >
            {t.remove}
          </Button>
        )}
      </Modal>
    </>
  );
}
