import { Alert, Button, Group, Modal, Paper, Stack, Text, Title } from '@mantine/core';
import { useState } from 'react';
import type { Member, SharedTaskReminder, Task, TaskList } from '@rodzina/shared';
import { describeReminder } from '../../components/reminderFields.js';
import { taskOfflineText, type TaskOperation } from './taskOffline.js';

const fieldNames: Record<string, string> = {
  title: 'Tytuł',
  notes: 'Notatka',
  dueDate: 'Termin',
  dueTime: 'Godzina',
  assigneeId: 'Osoba przypisana',
  isDone: 'Zrobione',
  reminders: 'Przypomnienia',
  position: 'Kolejność',
};
function valueText(field: string, value: unknown, members: Member[], timezone: string): string {
  if (value === null || value === '') return 'Brak';
  if (typeof value === 'boolean') return value ? 'Tak' : 'Nie';
  if (field === 'assigneeId') return members.find((member) => member.id === value)?.displayName ?? 'Nieobecny domownik';
  if (field === 'reminders')
    return (
      (value as SharedTaskReminder[])
        .map((reminder) => {
          const when =
            reminder.type === 'offset' && reminder.offsetValue === 0
              ? 'W terminie zadania'
              : describeReminder(reminder, timezone);
          return `${when} — ${reminder.audience === 'owner' ? 'Osoba odpowiedzialna' : 'Wszyscy na liście'}`;
        })
        .join('; ') || 'Brak'
    );
  return String(value);
}

export function TaskReviewPanel({
  operations,
  lists,
  items,
  alarms,
  discard,
  members,
  timezone,
}: {
  operations: TaskOperation[];
  lists: TaskList[];
  items: Record<string, Task[]>;
  alarms: boolean;
  discard: (ids: string[]) => Promise<void>;
  members: Member[];
  timezone: string;
}) {
  const [selected, setSelected] = useState<string[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const chains = new Map<string, TaskOperation[]>();
  for (const op of operations) {
    const key = `${op.listId}:${op.taskId}`;
    chains.set(key, [...(chains.get(key) ?? []), op]);
  }
  const inspected = operations.filter((op) => selected?.includes(op.id));
  const itemTitle = (op: TaskOperation, id: string) => {
    const current = items[op.listId]?.find((task) => task.id === op.taskId)?.checklist?.find((item) => item.id === id);
    if (current) return current.title;
    const created = operations.find(
      (entry) => entry.taskId === op.taskId && entry.change.type === 'checklist-create' && entry.change.data.id === id,
    );
    return created?.change.type === 'checklist-create'
      ? created.change.data.title
      : 'Podzadanie niedostępne na serwerze';
  };
  const close = () => {
    if (!saving) {
      setSelected(null);
      setConfirming(false);
      setError(undefined);
    }
  };
  if (!operations.length) return null;
  return (
    <>
      <Alert color="orange" title={taskOfflineText.review}>
        <Stack gap="sm">
          <Text>
            Zmiany do sprawdzenia: {operations.length}. Nie są wysyłane ani nakładane na dane potwierdzone przez serwer.
          </Text>
          <Text>
            Po odrzuceniu odśwież listę online. Następnie możesz świadomie wprowadzić zmianę ponownie zwykłym
            formularzem.
          </Text>
          {alarms && <Text size="sm">{taskOfflineText.alarms}</Text>}
          {[...chains].map(([key, chain]) => {
            const first = chain[0]!;
            const create = chain.find((op) => op.change.type === 'create');
            const title =
              create?.change.type === 'create'
                ? create.change.data.title
                : (items[first.listId]?.find((task) => task.id === first.taskId)?.title ??
                  'Zadanie niedostępne na serwerze');
            return (
              <Paper key={key} p="sm" withBorder style={{ overflowWrap: 'anywhere' }}>
                <Stack gap="xs">
                  <Text fw={600}>{title}</Text>
                  <Text size="sm">
                    {lists.find((list) => list.id === first.listId)?.name} · Zmiany: {chain.length}
                  </Text>
                  <Button
                    variant="light"
                    onClick={() => {
                      setSelected(chain.map((op) => op.id));
                      setConfirming(false);
                      setError(undefined);
                    }}
                  >
                    Sprawdź zmiany
                  </Button>
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      </Alert>
      <Modal opened={!!selected && inspected.length > 0} onClose={close} title={taskOfflineText.review}>
        <Stack style={{ overflowWrap: 'anywhere' }}>
          {inspected.map((op, index) => (
            <Paper key={op.id} withBorder p="sm">
              <Title order={3} size="h5">
                {index + 1}.{' '}
                {op.change.type === 'create'
                  ? 'Utworzenie zadania'
                  : op.change.type === 'update'
                    ? 'Edycja zadania'
                    : op.change.type === 'checklist-create'
                      ? 'Dodanie podzadania'
                      : op.change.type === 'checklist-update'
                        ? 'Zmiana podzadania'
                        : op.change.type === 'checklist-remove'
                          ? 'Usunięcie podzadania'
                          : op.change.type === 'checklist-order'
                            ? 'Kolejność podzadań'
                            : 'Usunięcie zadania'}
              </Title>
              {'itemId' in op.change && <Text>Podzadanie: {itemTitle(op, op.change.itemId)}</Text>}
              <Text size="sm">{new Date(op.submittedAt).toLocaleString('pl-PL')}</Text>
              <Text size="sm" c="orange.9">
                {op.reason === 'dependency'
                  ? taskOfflineText.dependent
                  : op.reason === 'conflict'
                    ? taskOfflineText.conflict
                    : op.reason === 'rejected'
                      ? taskOfflineText.rejected
                      : taskOfflineText.expired}
              </Text>
              {op.change.type === 'checklist-order' && (
                <Text>Kolejność: {op.change.data.itemIds.map((id) => itemTitle(op, id)).join(' → ')}</Text>
              )}
              {op.change.type !== 'remove' &&
                op.change.type !== 'checklist-order' &&
                op.change.type !== 'checklist-remove' &&
                Object.entries(op.change.data)
                  .filter(([key]) => !op.change.type.startsWith('checklist-') || ['title', 'isDone'].includes(key))
                  .map(([key, value]) => (
                    <Text key={key} style={{ whiteSpace: 'pre-wrap' }}>
                      <strong>{fieldNames[key] ?? key}:</strong> {valueText(key, value, members, timezone)}
                    </Text>
                  ))}
            </Paper>
          ))}
          {error && <Alert color="red">{error}</Alert>}
          {confirming && (
            <Alert color="orange">
              Odrzucić cały pokazany łańcuch ({inspected.length} zmian)? Dane na serwerze pozostaną bez zmian. Tych
              lokalnych zmian nie będzie można odzyskać.
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={close} disabled={saving}>
              Zamknij
            </Button>
            {!confirming ? (
              <Button color="red" onClick={() => setConfirming(true)}>
                Odrzuć łańcuch
              </Button>
            ) : (
              <Button
                color="red"
                loading={saving}
                onClick={() => {
                  setSaving(true);
                  void discard(selected!)
                    .then(() => {
                      setSelected(null);
                      setConfirming(false);
                    })
                    .catch((failure: unknown) =>
                      setError(failure instanceof Error ? failure.message : 'Nie udało się odrzucić zmian.'),
                    )
                    .finally(() => setSaving(false));
                }}
              >
                Potwierdź odrzucenie
              </Button>
            )}
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
