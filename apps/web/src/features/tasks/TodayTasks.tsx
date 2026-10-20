import { Alert, Button, Loader, Paper, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { taskUrl, type Task } from '@rodzina/shared';
import { Link } from 'react-router';
import { apiFetch } from '../../api.js';
import { useMe } from '../../auth.js';
import { useOffline } from '../../connectivity.js';
import { labels } from '../../i18n/pl.js';
import { SYNC_INTERVAL_MS } from '../../queryClient.js';
import { isTaskOverdue } from './taskRules.js';

const t = labels.tasksUi;
export function TodayTasks() {
  const { user, family, familyConfirmed } = useMe();
  const offline = useOffline();
  return (
    <Paper withBorder p="md" component="section" aria-label={t.today} style={{ minWidth: 0 }}>
      <Stack gap="xs">
        <Title order={3}>{t.today}</Title>
        {offline || !familyConfirmed || !user || !family ? (
          <Text size="sm" c="dimmed">
            {offline ? t.todayOffline : t.confirming}
          </Text>
        ) : (
          <TodayTasksOnline
            key={`${family.id}:${user.id}`}
            familyId={family.id}
            userId={user.id}
            timezone={family.timezone}
          />
        )}
      </Stack>
    </Paper>
  );
}

function TodayTasksOnline({ familyId, userId, timezone }: { familyId: string; userId: string; timezone: string }) {
  const query = useQuery({
    queryKey: ['tasks', familyId, userId, 'today'],
    queryFn: async ({ signal }) => (await apiFetch<{ tasks: Task[] }>('/api/tasks/today', { signal })).tasks,
    staleTime: 0,
    retry: false,
    refetchInterval: SYNC_INTERVAL_MS,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
  if (query.isError)
    return (
      <Alert color="red">
        {query.error.message}
        <Button variant="subtle" onClick={() => void query.refetch()}>
          {t.retry}
        </Button>
      </Alert>
    );
  if (!query.isFetchedAfterMount || !query.data) return <Loader aria-label={t.loading} />;
  if (!query.data.length)
    return (
      <Text size="sm" c="dimmed">
        {t.todayEmpty}
      </Text>
    );
  return query.data.map((task) => (
    <Stack gap={0} key={task.id}>
      <Text component={Link} to={taskUrl(task.listId, task.id)} fw={500} style={{ overflowWrap: 'anywhere' }}>
        {task.title}
      </Text>
      <Text size="sm" c={isTaskOverdue(task, timezone) ? 'red' : 'dimmed'}>
        {task.dueDate?.split('-').reverse().join('.')}
        {task.dueTime ? `, ${task.dueTime}` : ''}
        {isTaskOverdue(task, timezone) ? ` · ${t.overdue}` : ''}
      </Text>
    </Stack>
  ));
}
