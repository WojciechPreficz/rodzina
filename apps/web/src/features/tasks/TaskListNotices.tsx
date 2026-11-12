import { Alert, Button, Text } from '@mantine/core';
import type { Member, TaskList } from '@rodzina/shared';
import { labels } from '../../i18n/pl.js';
import { OfflineNotice } from '../../offline/OfflineNotice.js';
import { isAndroid } from '../../platform.js';
import { TaskRecurrenceNotice } from './TaskRecurrenceNotice.js';
import { TaskReviewPanel } from './TaskReviewPanel.js';
import { taskOfflineText } from './taskOffline.js';
import type { useTasks } from './taskQueries.js';

const t = labels.tasksUi;

export function TaskListNotices({
  data,
  lists,
  members,
  timezone,
  actionError,
  dismissError,
}: {
  data: Pick<
    ReturnType<typeof useTasks>,
    | 'offline'
    | 'syncedAt'
    | 'pendingCount'
    | 'pendingSuccessor'
    | 'pendingAlarms'
    | 'reviewOperations'
    | 'reviewItems'
    | 'discardReview'
    | 'syncError'
    | 'lists'
  >;
  lists: TaskList[];
  members: Member[];
  timezone: string;
  actionError: string | undefined;
  dismissError: () => void;
}) {
  return (
    <>
      <OfflineNotice offline={data.offline} syncedAt={data.syncedAt} role="alert">
        <Text>{taskOfflineText.banner}</Text>
        <Text mt="xs">{taskOfflineText.limits}</Text>
      </OfflineNotice>
      {data.pendingCount > 0 && (
        <Alert>
          <Text>Zmiany oczekujące na wysłanie: {data.pendingCount}</Text>
          <TaskRecurrenceNotice pending={data.pendingSuccessor} />
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
        timezone={timezone}
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
        <Alert color="red" withCloseButton onClose={dismissError}>
          {actionError}
        </Alert>
      )}
    </>
  );
}
