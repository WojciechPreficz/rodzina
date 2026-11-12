import {
  Alert,
  Avatar,
  Badge,
  Button,
  Collapse,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import type { Task } from '@rodzina/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { PageHeader } from '../../components/PageHeader.js';
import { labels } from '../../i18n/pl.js';
import { addNativeBackHandler, allowNavigation } from '../../nativeNavigation.js';
import { useMe } from '../../sessionContext.js';
import { useFormNavigation } from '../../useFormNavigation.js';
import { useMembersQuery } from '../family/index.js';
import { TaskListDialogs } from './TaskListDialogs.js';
import { TaskListNotices } from './TaskListNotices.js';
import { MemberAvatar, TaskRow } from './TaskRow.js';
import { taskOfflineText } from './taskOffline.js';
import { useTasks } from './taskQueries.js';
import { useTaskActions } from './useTaskActions.js';
import './tasks.css';

const t = labels.tasksUi;

export function TasksPage() {
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
  const [doneOpened, setDoneOpened] = useState(false);
  const actions = useTaskActions(data, navigate, setParams);
  const { resetForList } = actions;
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
    resetForList();
    setDoneOpened(false);
  }, [listId, resetForList]);
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
    <TaskRow
      key={task.id}
      task={task}
      members={members}
      timezone={family!.timezone}
      pending={data.update.isPending || data.clearDone.isPending || data.checklist.isPending}
      onToggleDone={actions.toggleDone}
      onToggleChecklistItem={actions.toggleChecklistItem}
      onOpen={actions.resetTaskUpdate}
    />
  );
  return (
    <Stack className={`tasks-page${listId ? ' tasks-page-detail' : ''}`} gap="lg">
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          <Button disabled={data.offline} onClick={actions.openAddList}>
            <span aria-hidden="true">＋&nbsp;</span>
            {t.addList}
          </Button>
        }
      />
      <TaskListNotices
        data={data}
        lists={lists}
        members={members}
        timezone={family!.timezone}
        actionError={actions.actionError}
        dismissError={actions.dismissError}
      />
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
                  <Button variant="default" disabled={data.offline} onClick={actions.openSettings}>
                    {t.settings}
                  </Button>
                ) : (
                  <Button
                    variant="subtle"
                    color="red.9"
                    disabled={data.offline}
                    loading={data.leaveList.isPending}
                    onClick={actions.leaveList}
                  >
                    {t.leaveList}
                  </Button>
                )}
              </Group>
              <TaskQuickAdd
                key={active.id}
                pending={data.create.isPending || data.tasks.isPending}
                onAdd={actions.quickAdd}
              />
              <Button variant="light" disabled={data.tasks.isPending} onClick={actions.openAddTask}>
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
                        onClick={actions.openClearDone}
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
      <TaskListDialogs
        data={data}
        actions={actions}
        canManageList={!!active && active.ownerId === user?.id}
        members={members}
        membersPending={membersQuery.isPending}
        membersError={membersQuery.error?.message}
        listMembers={listMembers}
        editedTask={editedTask}
      />
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
