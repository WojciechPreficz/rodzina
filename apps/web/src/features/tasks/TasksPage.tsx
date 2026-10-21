import {
  Alert,
  Avatar,
  Badge,
  Button,
  Checkbox,
  Collapse,
  Group,
  Loader,
  Modal,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { taskUrl, type Task } from '@rodzina/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMe } from '../../auth.js';
import { labels } from '../../i18n/pl.js';
import { allowNavigation } from '../../nativeNavigation.js';
import { useMembersQuery } from '../family/familyQueries.js';
import type { Member } from '../family/familyApi.js';
import { TaskForm } from './TaskForm.js';
import { TaskListSettings } from './TaskListSettings.js';
import { useTasks } from './taskQueries.js';
import { isTaskOverdue } from './taskRules.js';
import { taskOfflineText } from './taskOffline.js';
import { isAndroid } from '../../platform.js';

const t = labels.tasksUi;

function MemberAvatar({ member, id }: { member: Member | undefined; id: string }) {
  const name = member?.displayName ?? t.formerMember;
  return (
    <Avatar size="sm" radius="xl" color={member?.color ?? 'gray'} title={name} aria-label={name} key={id}>
      {name.slice(0, 1)}
    </Avatar>
  );
}

export function TasksPage() {
  const { listId } = useParams();
  return <TaskListPage key={listId ?? 'lists'} />;
}

function TaskListPage() {
  const { listId } = useParams();
  const { user, family } = useMe();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const data = useTasks(listId);
  const membersQuery = useMembersQuery();
  const members = membersQuery.data ?? (user ? [user] : []);
  const [addingList, setAddingList] = useState(false);
  const [listName, setListName] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [settingsOpened, setSettingsOpened] = useState(false);
  const [quickTitle, setQuickTitle] = useState('');
  const [doneOpened, setDoneOpened] = useState(false);
  const [clearingDone, setClearingDone] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const taskId = params.get('zadanie');
  const run = async (action: () => Promise<unknown>) => {
    setActionError(undefined);
    try {
      await action();
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t.failed);
      return false;
    }
  };
  const closeTask = () => {
    if (!allowNavigation()) return;
    setAddingTask(false);
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('zadanie');
      return next;
    });
  };
  if (!data.enabled)
    return (
      <Stack>
        <Title order={2}>{t.title}</Title>
        <Alert>{data.offline ? t.offline : t.confirming}</Alert>
      </Stack>
    );
  if (data.lists.isError)
    return (
      <Stack>
        <Title order={2}>{t.title}</Title>
        <Alert color="red">{data.lists.error?.message}</Alert>
        <Button onClick={() => void data.lists.refetch()}>{t.retry}</Button>
      </Stack>
    );
  if (!data.lists.data)
    return (
      <Stack>
        <Title order={2}>{t.title}</Title>
        {data.offline && <Alert>{taskOfflineText.limits}</Alert>}
        {data.syncError && <Alert color="red">{data.syncError}</Alert>}
        {data.offline || data.syncError ? <Alert>{taskOfflineText.empty}</Alert> : <Loader aria-label={t.loading} />}
      </Stack>
    );
  const lists = [...data.lists.data].sort(
    (a, b) =>
      Number(b.isDefault && b.ownerId === user?.id) - Number(a.isDefault && a.ownerId === user?.id) ||
      a.position - b.position,
  );
  const active = data.active;
  const visibleTasks = data.tasks.data ?? [];
  const editedTask = visibleTasks.find((task) => task.id === taskId);
  const listMembers = active
    ? members.filter((member) => [active.ownerId, ...active.memberIds].includes(member.id))
    : [];
  const row = (task: Task) => (
    <Paper component="article" aria-label={task.title} withBorder p="sm" key={task.id}>
      <Group wrap="nowrap" align="flex-start">
        <Checkbox
          mt={4}
          aria-label={t.check(task.title)}
          checked={task.isDone}
          disabled={data.update.isPending || data.clearDone.isPending}
          onChange={(event) => {
            const isDone = event.currentTarget.checked;
            void run(() => data.update.mutateAsync({ id: task.id, data: { isDone } }));
          }}
        />
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Text
            component={Link}
            to={taskUrl(task.listId, task.id)}
            onClick={() => data.update.reset()}
            fw={500}
            td={task.isDone ? 'line-through' : undefined}
            style={{ overflowWrap: 'anywhere' }}
          >
            {task.title}
          </Text>
          {task.dueDate && (
            <Text size="sm" c={isTaskOverdue(task, family!.timezone) ? 'red' : 'dimmed'}>
              {t.due}: {task.dueDate.split('-').reverse().join('.')}
              {task.dueTime ? `, ${task.dueTime}` : ''}
              {isTaskOverdue(task, family!.timezone) ? ` · ${t.overdue}` : ''}
            </Text>
          )}
        </Stack>
        {task.assigneeId && (
          <MemberAvatar id={task.assigneeId} member={members.find((member) => member.id === task.assigneeId)} />
        )}
      </Group>
    </Paper>
  );
  return (
    <Stack maw={860} w="100%" mx="auto">
      {data.offline && (
        <Alert title="Tryb offline">
          <Text>{taskOfflineText.banner}</Text>
          <Text mt="xs">{taskOfflineText.limits}</Text>
        </Alert>
      )}
      {data.pendingCount > 0 && (
        <Alert>
          <Text>Zmiany oczekujące na wysłanie: {data.pendingCount}</Text>
          {isAndroid() && data.pendingAlarms && <Text size="sm">{taskOfflineText.alarms}</Text>}
        </Alert>
      )}
      {data.syncError && (
        <Alert color="red">
          {data.syncError}
          <Button variant="subtle" onClick={() => void data.lists.refetch()}>
            {t.retry}
          </Button>
        </Alert>
      )}
      <Group justify="space-between">
        <Title order={2}>{t.title}</Title>
        <Button
          disabled={data.offline}
          onClick={() => {
            data.createList.reset();
            setAddingList(true);
          }}
        >
          {t.addList}
        </Button>
      </Group>
      {actionError && (
        <Alert color="red" withCloseButton onClose={() => setActionError(undefined)}>
          {actionError}
        </Alert>
      )}
      <Stack component="nav" aria-label={t.lists} gap="xs">
        {lists.map((list) => (
          <Paper withBorder p="sm" key={list.id}>
            <Group wrap="nowrap">
              <Text
                component={Link}
                to={`/zadania/${list.id}`}
                fw={active?.id === list.id ? 700 : 500}
                aria-current={active?.id === list.id ? 'page' : undefined}
                style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}
              >
                {list.name}
              </Text>
              <Badge aria-label={t.count(list.openTaskCount)}>{list.openTaskCount}</Badge>
              {list.memberIds.length > 0 && (
                <Avatar.Group>
                  {[list.ownerId, ...list.memberIds].slice(0, 3).map((id) => (
                    <MemberAvatar key={id} id={id} member={members.find((member) => member.id === id)} />
                  ))}
                  {list.memberIds.length > 2 && (
                    <Avatar size="sm" radius="xl">
                      +{list.memberIds.length - 2}
                    </Avatar>
                  )}
                </Avatar.Group>
              )}
            </Group>
          </Paper>
        ))}
      </Stack>
      {!listId && <Text c="dimmed">{t.chooseList}</Text>}
      {listId && !active && <Alert color="red">{t.unavailable}</Alert>}
      {active && (
        <Stack key={active.id}>
          <Group justify="space-between">
            <Title order={3} style={{ overflowWrap: 'anywhere' }}>
              {active.name}
            </Title>
            {active.ownerId === user?.id ? (
              <Button
                variant="default"
                disabled={data.offline}
                onClick={() => {
                  data.updateList.reset();
                  data.removeList.reset();
                  setSettingsOpened(true);
                }}
              >
                {t.settings}
              </Button>
            ) : (
              <Button
                variant="subtle"
                color="red"
                disabled={data.offline}
                loading={data.leaveList.isPending}
                onClick={() => {
                  if (window.confirm(t.leaveListConfirm))
                    void run(async () => {
                      await data.leaveList.mutateAsync();
                      void navigate('/zadania');
                    });
                }}
              >
                {t.leaveList}
              </Button>
            )}
          </Group>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (data.create.isPending || !quickTitle.trim()) return;
              void run(async () => {
                await data.create.mutateAsync({ title: quickTitle.trim() });
                setQuickTitle('');
              });
            }}
          >
            <Group align="flex-end" wrap="nowrap">
              <TextInput
                label={t.quickAdd}
                value={quickTitle}
                onChange={(event) => setQuickTitle(event.currentTarget.value)}
                maxLength={200}
                required
                disabled={data.create.isPending}
                style={{ flex: 1, minWidth: 0 }}
              />
              <Button type="submit" loading={data.create.isPending} disabled={!quickTitle.trim()}>
                {t.add}
              </Button>
            </Group>
          </form>
          <Button
            variant="light"
            onClick={() => {
              data.create.reset();
              setAddingTask(true);
            }}
          >
            {t.addTask}
          </Button>
          {data.tasks.isError ? (
            <Alert color="red">
              {data.tasks.error?.message}
              <Button variant="subtle" onClick={() => void data.tasks.refetch()}>
                {t.retry}
              </Button>
            </Alert>
          ) : !data.tasks.data ? (
            data.offline || data.syncError ? (
              <Alert>{taskOfflineText.empty}</Alert>
            ) : (
              <Loader aria-label={t.loading} />
            )
          ) : (
            <>
              {visibleTasks.filter((task) => !task.isDone).map(row)}
              {!visibleTasks.some((task) => !task.isDone) && <Text c="dimmed">{t.empty}</Text>}
              <Group justify="space-between">
                <Button
                  variant="subtle"
                  justify="flex-start"
                  aria-expanded={doneOpened}
                  aria-controls="done-tasks"
                  onClick={() => setDoneOpened((value) => !value)}
                >
                  {t.done} ({visibleTasks.filter((task) => task.isDone).length})
                </Button>
                {visibleTasks.some((task) => task.isDone) && (
                  <Button
                    size="xs"
                    variant="light"
                    color="red"
                    disabled={data.update.isPending || data.remove.isPending}
                    loading={data.clearDone.isPending}
                    onClick={() => {
                      data.clearDone.reset();
                      setClearingDone(true);
                    }}
                  >
                    {t.clearDone}
                  </Button>
                )}
              </Group>
              <Collapse in={doneOpened} id="done-tasks">
                <Stack>{visibleTasks.filter((task) => task.isDone).map(row)}</Stack>
              </Collapse>
              {taskId && !editedTask && <Alert color="red">{t.taskUnavailable}</Alert>}
            </>
          )}
        </Stack>
      )}
      <Modal
        opened={clearingDone}
        onClose={() => {
          if (!data.clearDone.isPending) setClearingDone(false);
        }}
        title={t.clearDone}
      >
        <Stack>
          <Text>{t.clearDoneConfirm}</Text>
          {data.clearDone.error && <Alert color="red">{data.clearDone.error.message}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" disabled={data.clearDone.isPending} onClick={() => setClearingDone(false)}>
              {t.cancel}
            </Button>
            <Button
              color="red"
              loading={data.clearDone.isPending}
              onClick={() => {
                void run(async () => {
                  await data.clearDone.mutateAsync();
                  setClearingDone(false);
                });
              }}
            >
              {t.clearDoneRemove}
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal opened={addingList && !data.offline} onClose={() => setAddingList(false)} title={t.addList}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!listName.trim() || data.createList.isPending) return;
            void run(async () => {
              const list = await data.createList.mutateAsync({ name: listName.trim() });
              setAddingList(false);
              setListName('');
              void navigate(`/zadania/${list.id}`);
            });
          }}
        >
          <Stack>
            {data.createList.error && <Alert color="red">{data.createList.error.message}</Alert>}
            <TextInput
              label={t.listName}
              value={listName}
              onChange={(event) => setListName(event.currentTarget.value)}
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
        opened={!data.offline && settingsOpened && !!active && active.ownerId === user?.id}
        onClose={() => {
          if (allowNavigation()) setSettingsOpened(false);
        }}
        title={t.settings}
      >
        {settingsOpened && active && active.ownerId === user?.id && (
          <TaskListSettings
            key={active.id}
            list={active}
            members={members}
            pending={data.updateList.isPending || data.removeList.isPending || membersQuery.isPending}
            error={data.updateList.error?.message ?? data.removeList.error?.message ?? membersQuery.error?.message}
            onSave={async (input) => {
              await data.updateList.mutateAsync(input);
            }}
            onDelete={async () => {
              await data.removeList.mutateAsync();
              void navigate('/zadania');
            }}
            onCancel={() => {
              if (allowNavigation()) setSettingsOpened(false);
            }}
          />
        )}
      </Modal>
      <Modal
        opened={!!active && (addingTask || !!editedTask)}
        onClose={closeTask}
        title={editedTask ? t.editTask : t.addTask}
      >
        {(addingTask || editedTask) && active && (
          <TaskForm
            key={`${active.id}:${editedTask?.id ?? 'new'}`}
            task={editedTask}
            members={listMembers}
            shared={active.memberIds.length > 0}
            pending={data.create.isPending || data.update.isPending || data.remove.isPending}
            error={(editedTask ? data.update.error : data.create.error)?.message}
            onCancel={closeTask}
            onSave={async (input, id, changes) => {
              if (id) return data.update.mutateAsync({ id, data: changes ?? input });
              return data.create.mutateAsync(input);
            }}
          />
        )}
        {editedTask && (
          <Button
            mt="md"
            color="red"
            variant="subtle"
            disabled={data.remove.isPending || data.update.isPending}
            onClick={() => {
              if (window.confirm(t.deleteConfirm))
                void run(async () => {
                  await data.remove.mutateAsync(editedTask.id);
                  closeTask();
                });
            }}
          >
            {t.remove}
          </Button>
        )}
      </Modal>
    </Stack>
  );
}
