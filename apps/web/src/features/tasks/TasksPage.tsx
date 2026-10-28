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
import { useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '@mantine/hooks';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMe } from '../../sessionContext.js';
import { labels } from '../../i18n/pl.js';
import { addNativeBackHandler, allowNavigation } from '../../nativeNavigation.js';
import { PageHeader } from '../../components/PageHeader.js';
import { useFormNavigation } from '../../useFormNavigation.js';
import { useMembersQuery } from '../family/familyQueries.js';
import type { Member } from '@rodzina/shared';

import { TaskForm } from './TaskForm.js';
import { TaskListSettings } from './TaskListSettings.js';
import { TaskReviewPanel } from './TaskReviewPanel.js';
import { useTasks } from './taskQueries.js';
import { isTaskOverdue } from './taskRules.js';
import { taskOfflineText } from './taskOffline.js';
import { isAndroid } from '../../platform.js';
import { OfflineNotice } from '../../offline/OfflineNotice.js';
import './tasks.css';

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
  return <TaskListPage />;
}

function TaskListPage() {
  const { listId } = useParams();
  const { user, family } = useMe();
  const navigate = useNavigate();
  const location = useLocation();
  const wide = useMediaQuery('(min-width: 48em)');
  const catalog = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const returnTo = useRef<{ id: string; scroll: number } | null>(null);
  const previous = useRef(listId);
  const [params, setParams] = useSearchParams();
  const data = useTasks(listId);
  const activeListId = data.active?.id;
  const membersQuery = useMembersQuery();
  const members = membersQuery.data ?? (user ? [user] : []);
  const [addingList, setAddingList] = useState(false);
  const [listName, setListName] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [settingsOpened, setSettingsOpened] = useState(false);
  const [doneOpened, setDoneOpened] = useState(false);
  const [clearingDone, setClearingDone] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const taskId = params.get('zadanie');
  const backToCatalog = () => {
    if (!allowNavigation()) return;
    if (location.state?.tasksCatalog) void navigate(-1);
    else void navigate('/zadania', { replace: true });
  };
  useEffect(() => {
    if (!listId || wide) return;
    return addNativeBackHandler(() => {
      if (location.state?.tasksCatalog) void navigate(-1);
      else void navigate('/zadania', { replace: true });
    });
  }, [listId, wide, location.state, navigate]);
  useEffect(() => {
    setAddingTask(false);
    setSettingsOpened(false);
    setDoneOpened(false);
    setClearingDone(false);
    setActionError(undefined);
  }, [listId]);
  useEffect(() => {
    if (previous.current === listId || (listId && !activeListId)) return;
    previous.current = listId;
    if (wide) return;
    const frame = requestAnimationFrame(() => {
      if (listId) {
        window.scrollTo(0, 0);
        heading.current?.focus({ preventScroll: true });
      } else if (returnTo.current) {
        const target = [...(catalog.current?.querySelectorAll<HTMLAnchorElement>('[data-list-id]') ?? [])].find(
          (link) => link.dataset.listId === returnTo.current?.id,
        );
        target?.focus({ preventScroll: true });
        window.scrollTo(0, returnTo.current.scroll);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [listId, wide, activeListId]);
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
    <Paper
      component="article"
      aria-label={task.title}
      className={`task-row${task.isDone ? ' task-row-done' : ''}`}
      key={task.id}
    >
      <Group wrap="nowrap" align="center">
        <label className="task-checkbox-target">
          <Checkbox
            className="task-checkbox"
            aria-label={t.check(task.title)}
            checked={task.isDone}
            disabled={data.update.isPending || data.clearDone.isPending}
            onChange={(event) => {
              const isDone = event.currentTarget.checked;
              void run(() => data.update.mutateAsync({ id: task.id, data: { isDone } }));
            }}
          />
        </label>
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Text
            component={Link}
            to={taskUrl(task.listId, task.id)}
            onClick={() => data.update.reset()}
            fw={500}
            className="task-title"
            td={task.isDone ? 'line-through' : undefined}
            style={{ overflowWrap: 'anywhere' }}
          >
            {task.title}
          </Text>
          {task.dueDate && (
            <Text size="sm" c={isTaskOverdue(task, family!.timezone) ? 'red.9' : 'dimmed'}>
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
    <Stack className={`tasks-page${listId ? ' tasks-page-detail' : ''}`} gap="lg">
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          <Button
            disabled={data.offline}
            onClick={() => {
              data.createList.reset();
              setAddingList(true);
            }}
          >
            <span aria-hidden="true">＋&nbsp;</span>
            {t.addList}
          </Button>
        }
      />
      <OfflineNotice offline={data.offline} syncedAt={data.syncedAt} role="alert">
        <Text>{taskOfflineText.banner}</Text>
        <Text mt="xs">{taskOfflineText.limits}</Text>
      </OfflineNotice>
      {data.pendingCount > 0 && (
        <Alert>
          <Text>Zmiany oczekujące na wysłanie: {data.pendingCount}</Text>
          {isAndroid() && data.pendingAlarms && <Text size="sm">{taskOfflineText.alarms}</Text>}
        </Alert>
      )}
      <TaskReviewPanel
        operations={data.reviewOperations}
        lists={lists}
        items={data.reviewItems}
        alarms={isAndroid() && data.pendingAlarms}
        discard={data.discardReview}
        members={members}
        timezone={family!.timezone}
      />
      {data.syncError && (
        <Alert color="red">
          {data.syncError}
          <Button variant="subtle" onClick={() => void data.lists.refetch()}>
            {t.retry}
          </Button>
        </Alert>
      )}
      {actionError && (
        <Alert color="red" withCloseButton onClose={() => setActionError(undefined)}>
          {actionError}
        </Alert>
      )}
      <div className="tasks-layout">
        <Paper component="nav" aria-label={t.lists} className="tasks-catalog" withBorder ref={catalog}>
          <Group justify="space-between" mb="md">
            <Title order={2} size="h4">
              {t.lists}
            </Title>
            <Text size="sm" c="dimmed">
              {lists.length}
            </Text>
          </Group>
          <Stack gap="xs">
            {lists.map((list) => (
              <Link
                key={list.id}
                className="task-list-card"
                data-list-id={list.id}
                aria-label={list.name}
                to={`/zadania/${list.id}`}
                state={{ tasksCatalog: !listId }}
                onClick={() => {
                  if (!wide && !listId) returnTo.current = { id: list.id, scroll: window.scrollY };
                }}
                aria-current={active?.id === list.id ? 'page' : undefined}
              >
                <span className="task-list-icon" aria-hidden="true">
                  ✓
                </span>
                <span className="task-list-summary">
                  <span className="task-list-name">{list.name}</span>
                  <Text component="span" size="xs" c="dimmed">
                    {list.memberIds.length ? t.sharedList : t.privateList}
                  </Text>
                </span>
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
              </Link>
            ))}
          </Stack>
          <Text size="xs" c="dimmed" mt="lg">
            {t.privacyHint}
          </Text>
        </Paper>
        <Paper component="section" className="tasks-content" withBorder aria-label={active?.name ?? t.lists}>
          <Button variant="subtle" className="tasks-back" onClick={backToCatalog}>
            ← {t.backToLists}
          </Button>
          {!listId && (
            <Text c="dimmed" className="tasks-empty">
              {t.chooseList}
            </Text>
          )}
          {listId && !active && <Alert color="red">{t.unavailable}</Alert>}
          {active && (
            <Stack key={active.id}>
              <Group justify="space-between">
                <div className="tasks-content-heading">
                  <Title order={2} ref={heading} tabIndex={-1}>
                    {active.name}
                  </Title>
                  <Group gap="xs" mt="xs">
                    <Text size="sm" c="dimmed">
                      {active.memberIds.length ? t.sharedList : t.privateList}
                    </Text>
                    {active.memberIds.length > 0 && (
                      <Avatar.Group>
                        {listMembers.map((member) => (
                          <MemberAvatar key={member.id} id={member.id} member={member} />
                        ))}
                      </Avatar.Group>
                    )}
                  </Group>
                </div>
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
                    color="red.9"
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
              <TaskQuickAdd
                key={active.id}
                pending={data.create.isPending || data.tasks.isPending}
                onAdd={(title) => run(() => data.create.mutateAsync({ title }))}
              />
              <Button
                variant="light"
                disabled={data.tasks.isPending}
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
                  <Group justify="space-between" className="tasks-done-heading">
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
                        color="red.9"
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
        </Paper>
      </div>
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
              color="red.9"
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
        size="lg"
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
        size="xl"
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
            color="red.9"
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

function TaskQuickAdd({ pending, onAdd }: { pending: boolean; onAdd: (title: string) => Promise<boolean> }) {
  const [title, setTitle] = useState('');
  const navigation = useFormNavigation();
  return (
    <form
      className="tasks-quick-add"
      data-navigation-guard="true"
      onChange={navigation.changed}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || !title.trim()) return;
        void onAdd(title.trim()).then((saved) => {
          if (!saved) return;
          setTitle('');
          navigation.saved();
        });
      }}
    >
      <Group align="flex-end" wrap="nowrap">
        <TextInput
          label={t.quickAdd}
          value={title}
          onChange={(event) => setTitle(event.currentTarget.value)}
          maxLength={200}
          required
          disabled={pending}
          style={{ flex: 1, minWidth: 0 }}
        />
        <Button type="submit" loading={pending} disabled={!title.trim()}>
          {t.add}
        </Button>
      </Group>
    </form>
  );
}
