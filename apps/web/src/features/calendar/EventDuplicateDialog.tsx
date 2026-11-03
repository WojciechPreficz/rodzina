import { Alert, Button, Group, Modal, Stack, Text } from '@mantine/core';
import type { EventDuplicate, EventDuplicateResolution } from '@rodzina/shared';

export function EventDuplicateDialog({
  opened,
  title,
  date,
  duplicates,
  pending,
  onClose,
  onResolve,
}: {
  opened: boolean;
  title: string;
  date: string;
  duplicates: EventDuplicate[];
  pending: boolean;
  onClose: () => void;
  onResolve: (resolution: EventDuplicateResolution) => void;
}) {
  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (!pending) onClose();
      }}
      title="Takie wydarzenie już istnieje"
      size="lg"
      closeOnEscape={!pending}
      closeOnClickOutside={!pending}
      withCloseButton={!pending}
    >
      <Stack>
        <Text>
          Wydarzenie „{title}” jest już w kalendarzu w dniu {date}. Zastąpić istniejące czy dodać kolejne?
        </Text>
        <Text size="sm" c="dimmed">
          Zastąpienie zapisze dane z tej propozycji w wybranym wydarzeniu. Dodanie kolejnego zachowa oba wpisy.
        </Text>
        {duplicates.length === 0 && (
          <Alert color="yellow">Poprzednie wydarzenie zmieniło się lub zostało usunięte. Możesz dodać nowy wpis.</Alert>
        )}
        {duplicates.map((duplicate) => (
          <Stack key={duplicate.eventId} gap="xs">
            <Text fw={600}>
              {duplicate.title} — {duplicate.startDate}, {duplicate.startTime ?? 'bez godziny'}
            </Text>
            <Button
              variant="default"
              disabled={pending || !duplicate.canReplace}
              onClick={() => onResolve({ action: 'replace', eventId: duplicate.eventId, version: duplicate.version })}
            >
              {duplicates.length === 1
                ? 'Zastąp istniejące'
                : `Zastąp: ${duplicate.title}${duplicate.startTime ? ` (${duplicate.startTime})` : ''}`}
            </Button>
            {!duplicate.canReplace && (
              <Text size="sm" c="dimmed">
                Ten wpis wymaga edycji w kalendarzu lub nie masz uprawnień do jego zastąpienia.
              </Text>
            )}
          </Stack>
        ))}
        <Group justify="flex-end">
          <Button variant="subtle" disabled={pending} onClick={onClose}>
            Anuluj
          </Button>
          <Button disabled={pending} onClick={() => onResolve({ action: 'add' })}>
            Dodaj kolejne
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
