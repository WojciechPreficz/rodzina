import { Alert, Button, Checkbox, Group, Paper, Stack, Text, TextInput } from '@mantine/core';
import type { Task } from '@rodzina/shared';
import { useEffect, useRef, useState } from 'react';
import { unknownChecklistText } from './taskChecklistOffline.js';
import type { TaskOperation } from './taskSchemas.js';
import { TaskProgress } from './TaskProgress.js';

export type ChecklistChange = (change: TaskOperation['change']) => Promise<unknown>;

export function TaskChecklist({
  task,
  onChange,
  pending = false,
  onDraftChange,
}: {
  task?: Task | undefined;
  onChange?: ChecklistChange | undefined;
  pending?: boolean;
  onDraftChange?: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string>();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const checkboxes = useRef(new Map<string, HTMLInputElement>());
  const restoreFocus = useRef<string | undefined>(undefined);
  const navigation = { changed: () => onDraftChange?.(true), saved: () => onDraftChange?.(false) };
  const disabled = busy || pending;
  useEffect(() => {
    if (disabled || !restoreFocus.current) return;
    const target =
      restoreFocus.current === 'new'
        ? input.current
        : restoreFocus.current.startsWith('check:')
          ? checkboxes.current.get(restoreFocus.current.slice(6))
          : editButtons.current.get(restoreFocus.current);
    target?.focus();
    restoreFocus.current = undefined;
  }, [disabled, task, editing]);
  const run = async (change: TaskOperation['change'], saved?: () => void) => {
    if (disabled || !onChange) return;
    setBusy(true);
    setError(undefined);
    try {
      await onChange(change);
      saved?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nie udało się zapisać podzadania.');
    } finally {
      setBusy(false);
    }
  };
  const add = () => {
    if (!draft.trim()) return;
    void run({ type: 'checklist-create', data: { id: crypto.randomUUID(), title: draft.trim() } }, () => {
      setDraft('');
      navigation.saved();
      restoreFocus.current = 'new';
    });
  };
  return (
    <Paper
      component="section"
      withBorder
      className="task-form-section task-checklist"
      aria-label="Podzadania"
      onChange={(event) => event.stopPropagation()}
    >
      <Stack>
        <Text fw={600}>Podzadania</Text>
        <Text size="sm">
          Zmiany podzadań zapisujemy od razu na urządzeniu. Ukończenie zadania i podzadań jest niezależne.
        </Text>
        {!task ? (
          <Text>Zapisz zadanie, aby dodać podzadania.</Text>
        ) : task.checklist === undefined || task.checklistOrderVersion === undefined ? (
          <Alert>{unknownChecklistText}</Alert>
        ) : (
          <>
            <TaskProgress task={task} />
            {error && <Alert color="red">{error}</Alert>}
            {busy && <Text role="status">Zapisywanie podzadania…</Text>}
            {!task.checklist.length && <Text>Brak podzadań.</Text>}
            <Stack component="ol" gap="sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {task.checklist.map((item, index) => (
                <Stack component="li" key={item.id} gap="xs" className="task-checklist-item">
                  <Checkbox
                    ref={(element) => {
                      if (element) checkboxes.current.set(item.id, element);
                      else checkboxes.current.delete(item.id);
                    }}
                    label={item.title}
                    checked={item.isDone}
                    disabled={disabled || !!editing || !!draft}
                    onChange={(event) => {
                      restoreFocus.current = `check:${item.id}`;
                      void run({
                        type: 'checklist-update',
                        itemId: item.id,
                        data: { isDone: event.currentTarget.checked, doneVersion: item.doneVersion },
                      });
                    }}
                  />
                  {editing === item.id ? (
                    <>
                      <TextInput
                        label="Nazwa podzadania"
                        value={title}
                        maxLength={200}
                        autoFocus
                        disabled={disabled}
                        onChange={(event) => {
                          setTitle(event.currentTarget.value);
                          navigation.changed();
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            if (title.trim())
                              void run(
                                {
                                  type: 'checklist-update',
                                  itemId: item.id,
                                  data: { title: title.trim(), version: item.version },
                                },
                                () => {
                                  setEditing(undefined);
                                  navigation.saved();
                                  restoreFocus.current = item.id;
                                },
                              );
                          }
                        }}
                      />
                      <Group>
                        <Button
                          disabled={disabled || !title.trim()}
                          onClick={() =>
                            void run(
                              {
                                type: 'checklist-update',
                                itemId: item.id,
                                data: { title: title.trim(), version: item.version },
                              },
                              () => {
                                setEditing(undefined);
                                navigation.saved();
                                restoreFocus.current = item.id;
                              },
                            )
                          }
                        >
                          Zapisz podzadanie
                        </Button>
                        <Button
                          variant="default"
                          disabled={disabled}
                          onClick={() => {
                            setEditing(undefined);
                            navigation.saved();
                            restoreFocus.current = item.id;
                          }}
                        >
                          Anuluj edycję
                        </Button>
                      </Group>
                    </>
                  ) : (
                    <Group gap="xs">
                      <Button
                        ref={(element) => {
                          if (element) editButtons.current.set(item.id, element);
                          else editButtons.current.delete(item.id);
                        }}
                        variant="default"
                        disabled={disabled || !!editing || !!draft}
                        aria-label={`Edytuj podzadanie: ${item.title}`}
                        onClick={() => {
                          setEditing(item.id);
                          setTitle(item.title);
                        }}
                      >
                        Edytuj
                      </Button>
                      <Button
                        variant="default"
                        disabled={disabled || !!editing || !!draft || index === 0}
                        aria-label={`Przenieś wyżej: ${item.title}`}
                        onClick={() => {
                          const ids = task.checklist!.map((entry) => entry.id);
                          [ids[index - 1], ids[index]] = [ids[index]!, ids[index - 1]!];
                          void run(
                            {
                              type: 'checklist-order',
                              data: { itemIds: ids, orderVersion: task.checklistOrderVersion! },
                            },
                            () => {
                              restoreFocus.current = item.id;
                            },
                          );
                        }}
                      >
                        ↑
                      </Button>
                      <Button
                        variant="default"
                        disabled={disabled || !!editing || !!draft || index === task.checklist!.length - 1}
                        aria-label={`Przenieś niżej: ${item.title}`}
                        onClick={() => {
                          const ids = task.checklist!.map((entry) => entry.id);
                          [ids[index], ids[index + 1]] = [ids[index + 1]!, ids[index]!];
                          void run(
                            {
                              type: 'checklist-order',
                              data: { itemIds: ids, orderVersion: task.checklistOrderVersion! },
                            },
                            () => {
                              restoreFocus.current = item.id;
                            },
                          );
                        }}
                      >
                        ↓
                      </Button>
                      <Button
                        variant="subtle"
                        color="red.9"
                        disabled={disabled || !!editing || !!draft}
                        aria-label={`Usuń podzadanie: ${item.title}`}
                        onClick={() => {
                          if (window.confirm(`Usunąć podzadanie „${item.title}”?`))
                            void run(
                              {
                                type: 'checklist-remove',
                                itemId: item.id,
                                data: { version: item.version, doneVersion: item.doneVersion },
                              },
                              () => {
                                restoreFocus.current = 'new';
                              },
                            );
                        }}
                      >
                        Usuń
                      </Button>
                    </Group>
                  )}
                </Stack>
              ))}
            </Stack>
            {task.checklist.length >= 100 ? (
              <Alert>Osiągnięto limit 100 podzadań.</Alert>
            ) : (
              <>
                <TextInput
                  ref={input}
                  label="Nowe podzadanie"
                  value={draft}
                  maxLength={200}
                  disabled={disabled || !!editing}
                  onChange={(event) => {
                    setDraft(event.currentTarget.value);
                    navigation.changed();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      add();
                    }
                  }}
                />
                <Button disabled={disabled || !!editing || !draft.trim()} onClick={add}>
                  Dodaj podzadanie
                </Button>
              </>
            )}
          </>
        )}
      </Stack>
    </Paper>
  );
}
