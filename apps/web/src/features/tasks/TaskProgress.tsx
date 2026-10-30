import { Text } from '@mantine/core';
import type { Task } from '@rodzina/shared';
import { checklistProgress } from './taskChecklistOffline.js';

export function TaskProgress({ task }: { task: Task }) {
  const progress = checklistProgress(task);
  if (progress?.total === 0) return null;
  return (
    <Text size="sm" c="dimmed">
      Podzadania: {progress ? `${progress.done} z ${progress.total}` : 'brak zapisanych danych'}
    </Text>
  );
}
