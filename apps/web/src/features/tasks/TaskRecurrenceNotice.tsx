import { Text } from '@mantine/core';
import { recurrencePendingText } from './taskRecurrenceOffline.js';

export function TaskRecurrenceNotice({ pending }: { pending: boolean }) {
  return pending ? (
    <Text size="sm" role="status">
      {recurrencePendingText}
    </Text>
  ) : null;
}
