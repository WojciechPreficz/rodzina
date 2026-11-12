import { Avatar, Checkbox, Group, Paper, Stack, Text } from '@mantine/core';
import { taskUrl, type Member, type Task, type TaskChecklistItem } from '@rodzina/shared';
import { Link } from 'react-router';
import { labels } from '../../i18n/pl.js';
import { TaskProgress } from './TaskProgress.js';
import { isTaskOverdue } from './taskRules.js';

const t = labels.tasksUi;

export function MemberAvatar({ member, id }: { member: Member | undefined; id: string }) {
  const name = member?.displayName ?? t.formerMember;
  return (
    <Avatar size="sm" radius="xl" color={member?.color ?? 'gray'} title={name} aria-label={name} key={id}>
      {name.slice(0, 1)}
    </Avatar>
  );
}

export function TaskRow({
  task,
  members,
  timezone,
  pending,
  onToggleDone,
  onToggleChecklistItem,
  onOpen,
}: {
  task: Task;
  members: Member[];
  timezone: string;
  pending: boolean;
  onToggleDone: (task: Task, isDone: boolean) => void;
  onToggleChecklistItem: (taskId: string, item: TaskChecklistItem, isDone: boolean) => void;
  onOpen: () => void;
}) {
  return (
    <Paper component="article" aria-label={task.title} className={`task-row${task.isDone ? ' task-row-done' : ''}`}>
      <Group wrap="nowrap" align="center">
        <label className="task-checkbox-target">
          <Checkbox
            className="task-checkbox"
            aria-label={t.check(task.title)}
            checked={task.isDone}
            disabled={pending}
            onChange={(event) => onToggleDone(task, event.currentTarget.checked)}
          />
        </label>
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Text
            component={Link}
            to={taskUrl(task.listId, task.id)}
            onClick={onOpen}
            fw={500}
            className="task-title"
            td={task.isDone ? 'line-through' : undefined}
            style={{ overflowWrap: 'anywhere' }}
          >
            {task.title}
          </Text>
          <TaskProgress task={task} />
          {task.recurrence && (
            <Text size="sm" c="dimmed">
              ↻ Seria ·{' '}
              {task.recurrence.state === 'skipped'
                ? 'Pominięto'
                : task.recurrence.state === 'done'
                  ? 'Wykonano'
                  : 'Jedno aktywne wystąpienie'}
            </Text>
          )}
          {task.dueDate && (
            <Text size="sm" c={isTaskOverdue(task, timezone) ? 'red.9' : 'dimmed'}>
              {t.due}: {task.dueDate.split('-').reverse().join('.')}
              {task.dueTime ? `, ${task.dueTime}` : ''}
              {isTaskOverdue(task, timezone) ? ` · ${t.overdue}` : ''}
            </Text>
          )}
        </Stack>
        {task.assigneeId && (
          <MemberAvatar id={task.assigneeId} member={members.find((member) => member.id === task.assigneeId)} />
        )}
      </Group>
      {!!task.checklist?.length && (
        <Stack component="ul" className="task-row-checklist" gap={0} aria-label={`Podzadania: ${task.title}`}>
          {task.checklist.map((item) => (
            <li key={item.id}>
              <Checkbox
                label={item.title}
                checked={item.isDone}
                disabled={pending}
                styles={{ label: { textDecoration: item.isDone ? 'line-through' : undefined } }}
                onChange={(event) => onToggleChecklistItem(task.id, item, event.currentTarget.checked)}
              />
            </li>
          ))}
        </Stack>
      )}
    </Paper>
  );
}
