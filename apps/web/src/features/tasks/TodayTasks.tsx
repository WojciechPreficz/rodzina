import { Alert, Loader, Paper, Stack, Text, Title } from '@mantine/core';
import { taskUrl } from '@rodzina/shared';
import { Link } from 'react-router';
import { useEffect, useState } from 'react';
import { useMe } from '../../auth.js';
import { labels } from '../../i18n/pl.js';
import { isTaskOverdue } from './taskRules.js';
import { useTaskData } from './taskQueries.js';
import { taskOfflineText } from './taskOffline.js';
import './todayTasks.css';

const t = labels.tasksUi;
export function TodayTasks() {
  const { family } = useMe();
  const data = useTaskData();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: family?.timezone ?? 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const complete = data.lists && data.lists.every((list) => data.items[list.id] !== undefined);
  const tasks = Object.values(data.items)
    .flat()
    .filter((task) => !task.isDone && task.dueDate && task.dueDate <= today)
    .sort(
      (a, b) =>
        a.dueDate!.localeCompare(b.dueDate!) ||
        (a.dueTime ?? '').localeCompare(b.dueTime ?? '') ||
        a.position - b.position ||
        a.id.localeCompare(b.id),
    );
  return (
    <Paper className="today-tasks" withBorder p="lg" component="section" aria-label={t.today} style={{ minWidth: 0 }}>
      <span className="today-tasks-icon" aria-hidden="true">
        ✓
      </span>
      <Stack gap="xs">
        <Title order={2} size="sm">
          {t.today}
        </Title>
        {data.offline && (
          <Text size="sm" c="dimmed">
            Pokazujemy zapisane zadania i oczekujące zmiany.
          </Text>
        )}
        {!complete &&
          (data.offline || data.error ? <Alert>{taskOfflineText.empty}</Alert> : <Loader aria-label={t.loading} />)}
        {complete && !tasks.length && (
          <Text size="sm" c="dimmed">
            {t.todayEmpty}
          </Text>
        )}
        {tasks.map((task) => (
          <Stack gap={0} key={task.id}>
            <Text
              className="today-task-link"
              component={Link}
              to={taskUrl(task.listId, task.id)}
              fw={500}
              style={{ overflowWrap: 'anywhere' }}
            >
              {task.title}
            </Text>
            <Text size="sm" c={isTaskOverdue(task, family?.timezone ?? 'Europe/Warsaw') ? 'red' : 'dimmed'}>
              {task.dueDate?.split('-').reverse().join('.')}
              {task.dueTime ? `, ${task.dueTime}` : ''}
              {isTaskOverdue(task, family?.timezone ?? 'Europe/Warsaw') ? ` · ${t.overdue}` : ''}
            </Text>
          </Stack>
        ))}
      </Stack>
      <time
        className="today-tasks-date"
        dateTime={today}
        aria-label={new Intl.DateTimeFormat('pl-PL', {
          timeZone: family?.timezone ?? 'Europe/Warsaw',
          dateStyle: 'long',
        }).format(now)}
      >
        <b>{today.split('-')[2]}</b>
        <span>
          {new Intl.DateTimeFormat('pl-PL', { timeZone: family?.timezone ?? 'Europe/Warsaw', month: 'short' }).format(
            now,
          )}
        </span>
      </time>
    </Paper>
  );
}
