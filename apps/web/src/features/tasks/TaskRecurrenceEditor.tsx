import {
  Alert,
  Button,
  Checkbox,
  Group,
  Loader,
  NumberInput,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import {
  firstTaskOccurrence,
  nextTaskOccurrence,
  taskRecurrenceRuleSchema,
  taskSeriesHistoryResponseSchema,
  taskSeriesResponseSchema,
  taskSeriesTemplateSchema,
  type Task,
  type TaskRecurrenceRule,
  type TaskSeriesTemplate,
  type SharedTaskReminder,
} from '@rodzina/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { apiFetch } from '../../api.js';
import { isOffline } from '../../connectivity.js';
import { useMe } from '../../sessionContext.js';
import { refreshLocalSchedule } from '../notifications/scheduleSync.js';
import { taskStore } from './taskOffline.js';
import { skippedTaskDates } from './taskRecurrencePreview.js';

type Props = {
  task?: Task | undefined;
  template: Omit<TaskSeriesTemplate, 'reminders'> & { reminders: SharedTaskReminder[] };
  disabled: boolean;
  prepare: () => Promise<Task>;
  onSaved: () => void;
  onBusy: (busy: boolean) => void;
  onDirty?: () => void;
  personalChanged?: boolean;
};

export function TaskRecurrenceEditor(props: Props) {
  const { user, family } = useMe();
  const id = props.task?.recurrence?.seriesId;
  const query = useQuery({
    queryKey: ['task-series', family?.id, user?.id, id],
    queryFn: async ({ signal }) =>
      taskSeriesResponseSchema.parse(await apiFetch(`/api/tasks/series/${id}`, { signal })),
    enabled: !!id && !props.disabled,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: 'always',
  });
  if (id && !props.disabled && (!query.data || !query.isFetchedAfterMount))
    return query.isError ? (
      <Alert color="red">
        {query.error.message}
        <Button onClick={() => void query.refetch()}>Pobierz serię ponownie</Button>
      </Alert>
    ) : (
      <Loader aria-label="Pobieranie serii" />
    );
  return (
    <RecurrenceFields
      key={`${props.task?.id ?? 'new'}:${query.data?.series.version ?? 'new'}`}
      {...props}
      series={query.data?.series}
    />
  );
}

function RecurrenceFields({
  task,
  template,
  disabled,
  prepare,
  onSaved,
  onBusy,
  onDirty,
  personalChanged,
  series,
}: Props & { series: ReturnType<typeof taskSeriesResponseSchema.parse>['series'] | undefined }) {
  const { user } = useMe();
  const client = useQueryClient();
  const [mode, setMode] = useState<string>(series?.rule.mode ?? 'none');
  const [unit, setUnit] = useState<TaskRecurrenceRule['unit']>(series?.rule.unit ?? 'week');
  const [interval, setInterval] = useState<string | number>(series?.rule.interval ?? 1);
  const [startDate, setStartDate] = useState(series?.rule.startDate ?? task?.dueDate ?? '');
  const [time, setTime] = useState(series?.rule.time ?? task?.dueTime ?? '');
  const [endDate, setEndDate] = useState(series?.rule.endDate ?? '');
  const [weekdays, setWeekdays] = useState<number[]>(series?.rule.weekdays ?? []);
  const [copyChecklist, setCopyChecklist] = useState(!series);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [historyOpened, setHistoryOpened] = useState(false);
  const operation = useRef<{ fingerprint: string; id: string; body: string } | undefined>(undefined);
  const history = useQuery({
    queryKey: ['task-series-history', user?.id, series?.id],
    queryFn: async ({ signal }) =>
      taskSeriesHistoryResponseSchema.parse(await apiFetch(`/api/tasks/series/${series!.id}/history`, { signal })),
    enabled: historyOpened && !!series && !disabled,
    retry: false,
  });
  const rule = taskRecurrenceRuleSchema.safeParse({
    mode,
    unit,
    interval,
    startDate,
    time: time || null,
    endDate: endDate || null,
    timezone: 'Europe/Warsaw',
    ...(mode === 'schedule' && unit === 'week' && weekdays.length ? { weekdays } : {}),
  });
  const first = rule.success ? firstTaskOccurrence(rule.data) : null;
  const planned =
    series && rule.success && JSON.stringify(series.rule) === JSON.stringify(rule.data)
      ? (task?.recurrence?.plannedDate ?? first)
      : first;
  const next =
    rule.success && planned
      ? nextTaskOccurrence(rule.data, planned, {
          actualAt: Date.now(),
          receivedAt: Date.now(),
          createdAt: 0,
          previousClosedAt: null,
        })
      : null;
  const unknown = !!task && task.recurrence === undefined;
  const skipped = rule.success && planned ? skippedTaskDates(rule.data, planned, Date.now()) : null;
  const active = !task?.isDone && (!series || (series.state === 'active' && task?.recurrence?.state === 'active'));
  const blocked = disabled || busy || unknown || !active || (!!task?.recurrence && !series);
  const write = async (action: 'configure' | 'skip' | 'stop') => {
    if (blocked || isOffline() || (action === 'configure' && (!rule.success || !first))) return;
    if (
      action !== 'configure' &&
      !window.confirm(
        action === 'skip'
          ? 'Pominąć to wystąpienie i wyznaczyć kolejne?'
          : 'Zatrzymać serię? Bieżące zadanie pozostanie jednorazowe.',
      )
    )
      return;
    setBusy(true);
    onBusy(true);
    setError(undefined);
    try {
      if (action === 'configure' && personalChanged)
        throw new Error('Zapisz najpierw zmiany osobistych przypomnień przyciskiem zapisu pojedynczego zadania.');
      if (action === 'configure' && template.reminders.some((item) => item.type !== 'offset'))
        throw new Error(
          'Seria obsługuje tylko względne wspólne przypomnienia. Usuń przypomnienie o stałej dacie lub zapisz tylko to zadanie.',
        );
      if (action === 'configure' && !taskSeriesTemplateSchema.safeParse(template).success)
        throw new Error('Uzupełnij poprawną nazwę i pola wzorca serii.');
      const target = task ?? (await prepare());
      if (isOffline()) throw new Error('Konfiguracja serii wymaga połączenia z internetem.');
      const path =
        action === 'skip'
          ? `/api/tasks/${target.id}/skip`
          : action === 'stop'
            ? `/api/tasks/series/${series!.id}/stop`
            : series
              ? `/api/tasks/series/${series.id}`
              : `/api/tasks/${target.id}/recurrence`;
      const versions = {
        expectedVersion: series?.version ?? 0,
        expectedOccurrenceVersion: target.recurrence?.version ?? 0,
      };
      const body =
        action === 'configure'
          ? {
              ...versions,
              rule: rule.success ? rule.data : null,
              template: {
                ...template,
                ...(copyChecklist
                  ? { checklist: target.checklist?.map((item) => item.title) ?? [] }
                  : series?.template.checklist !== undefined
                    ? { checklist: series.template.checklist }
                    : {}),
              },
            }
          : action === 'stop'
            ? versions
            : {
                expectedSeriesVersion: series!.version,
                expectedOccurrenceVersion: target.recurrence!.version,
                closedAt: Date.now(),
              };
      // Keep the operation and actual closure time when retrying a lost response.
      const fingerprint = JSON.stringify({ path, body: action === 'skip' ? { ...body, closedAt: 0 } : body });
      if (operation.current?.fingerprint !== fingerprint)
        operation.current = { fingerprint, id: crypto.randomUUID(), body: JSON.stringify(body) };
      await apiFetch(`${path}?operationId=${operation.current.id}&actorId=${user!.id}`, {
        method: action === 'configure' && series ? 'PATCH' : 'POST',
        body: operation.current.body,
      });
      await taskStore.synchronize();
      await Promise.all([
        refreshLocalSchedule(client),
        client.invalidateQueries({ queryKey: ['task-series'] }),
        client.invalidateQueries({ queryKey: ['task-series-history'] }),
      ]);
      onSaved();
    } catch (cause) {
      setError(
        `${cause instanceof Error ? cause.message : 'Nie udało się zapisać serii.'} Przy konflikcie zamknij formularz, odśwież zadania i sprawdź aktualne dane przed kolejną zmianą.`,
      );
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };
  return (
    <Paper component="section" withBorder p="md" aria-label="Powtarzaj" onChange={onDirty}>
      <Stack>
        <Text fw={600}>Powtarzaj</Text>
        <Text size="sm">
          Jedno aktywne zadanie. Zaległe czeka na wykonanie lub pominięcie. Kolejne powstaje po synchronizacji;
          zamknięte APK nie pobiera zmian.
        </Text>
        {disabled && (
          <Alert>
            Konfiguracja, pomijanie, zatrzymanie i historia wymagają połączenia. Wykonanie pobranego zadania działa
            offline.
          </Alert>
        )}
        {unknown && <Alert>Brak danych o cykliczności. Pobierz aktualne zadania przed konfiguracją.</Alert>}
        {error && <Alert color="red">{error}</Alert>}
        <Select
          label="Powtarzanie"
          value={mode}
          disabled={blocked}
          data={[
            ...(!series ? [{ value: 'none', label: 'Nie powtarzaj' }] : []),
            { value: 'schedule', label: 'Według kalendarza' },
            { value: 'after_completion', label: 'Po wykonaniu lub pominięciu' },
          ]}
          onChange={(value) => {
            onDirty?.();
            setMode(value ?? 'none');
          }}
        />
        {mode !== 'none' && (
          <>
            <Group grow>
              <NumberInput
                label="Co ile"
                min={1}
                max={1000}
                allowDecimal={false}
                value={interval}
                disabled={blocked}
                onChange={setInterval}
              />
              <Select
                label="Jednostka"
                value={unit}
                disabled={blocked}
                data={[
                  { value: 'day', label: 'Dni' },
                  { value: 'week', label: 'Tygodnie' },
                  { value: 'month', label: 'Miesiące' },
                  { value: 'year', label: 'Lata' },
                ]}
                onChange={(value) => {
                  onDirty?.();
                  setUnit(value as TaskRecurrenceRule['unit']);
                }}
              />
            </Group>
            <TextInput
              type="date"
              label="Początek serii"
              value={startDate}
              disabled={blocked}
              onChange={(e) => setStartDate(e.currentTarget.value)}
            />
            <TextInput
              type="time"
              label="Godzina serii (Warszawa)"
              value={time}
              disabled={blocked}
              onChange={(e) => setTime(e.currentTarget.value)}
            />
            <TextInput
              type="date"
              label="Koniec serii (włącznie, opcjonalnie)"
              value={endDate}
              disabled={blocked}
              onChange={(e) => setEndDate(e.currentTarget.value)}
            />
            {mode === 'schedule' && unit === 'week' && (
              <Group aria-label="Dni tygodnia">
                {['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd'].map((day, index) => (
                  <Checkbox
                    key={day}
                    label={day}
                    checked={weekdays.includes(index + 1)}
                    disabled={blocked}
                    onChange={(e) =>
                      setWeekdays(
                        e.currentTarget.checked
                          ? [...weekdays, index + 1].sort((a, b) => a - b)
                          : weekdays.filter((d) => d !== index + 1),
                      )
                    }
                  />
                ))}
              </Group>
            )}
            <Text size="sm" role="status">
              {first
                ? `Termin wystąpienia: ${planned}${time ? `, ${time}` : ''}. Następne po zamknięciu teraz: ${next?.status === 'ready' ? (next.nextDate ?? 'koniec serii') : 'wymaga sprawdzenia'}.`
                : 'Uzupełnij poprawną regułę i daty.'}
            </Text>
            {mode === 'schedule' && (
              <Text size="sm">
                Po spóźnieniu pomijamy minione daty rytmu, bez tworzenia zaległych kopii. Bez wyboru dni używamy dnia
                początku serii.
              </Text>
            )}
            {(!!skipped?.dates.length || skipped?.more) && (
              <Text size="sm">
                Przy zamknięciu teraz pominięte daty rytmu:{' '}
                {skipped.dates.length ? skipped.dates.join(', ') : 'starsze terminy'}
                {skipped.more ? ' i kolejne' : ''}.
              </Text>
            )}
            <Checkbox
              label="Użyj bieżącej checklisty jako wzorca kolejnych zadań"
              checked={copyChecklist}
              disabled={blocked || task?.checklist === undefined}
              onChange={(e) => setCopyChecklist(e.currentTarget.checked)}
            />
            <Text size="sm">
              Zapisz poniżej zmiany tylko tego zadania. Przycisk „Zapisz to i kolejne” zapisuje nazwę, notatkę i
              przypisanie z formularza, regułę oraz wybrany wzorzec. Checklista bieżącego i historycznych zadań
              zachowuje swój postęp; następca zaczyna od 0.
            </Text>
            <Button
              disabled={blocked || !rule.success || !first || (!series && task?.checklist === undefined && !!task)}
              loading={busy}
              onClick={() => void write('configure')}
            >
              {series ? 'Zapisz to i kolejne' : 'Utwórz serię'}
            </Button>
          </>
        )}
        {series && (
          <>
            <Text size="sm">
              Stan serii:{' '}
              {series.state === 'active' ? 'aktywna' : series.state === 'ended' ? 'zakończona' : 'zatrzymana'}. Wzorcowa
              checklista: {series.template.checklist?.length ?? 0} kroków.
            </Text>
            <Group>
              <Button variant="light" disabled={blocked} onClick={() => void write('skip')}>
                Pomiń wystąpienie
              </Button>
              <Button variant="light" color="red" disabled={blocked} onClick={() => void write('stop')}>
                Zatrzymaj serię
              </Button>
            </Group>
            <Button
              variant="subtle"
              disabled={disabled || busy}
              onClick={() => setHistoryOpened((value) => !value)}
              aria-expanded={historyOpened}
            >
              Historia serii
            </Button>
            {historyOpened &&
              (history.isError ? (
                <Alert color="red">
                  {history.error.message}
                  <Button onClick={() => void history.refetch()}>Ponów historię</Button>
                </Alert>
              ) : !history.data ? (
                <Loader aria-label="Pobieranie historii" />
              ) : (
                <Stack>
                  {!history.data.history.length && <Text>Brak zamkniętych wystąpień.</Text>}
                  {history.data.history.map((item) => (
                    <Text key={item.id} size="sm">
                      {item.plannedDate} {item.plannedTime} · {item.title} ·{' '}
                      {item.state === 'done' ? 'Wykonano' : 'Pominięto'}:{' '}
                      {new Intl.DateTimeFormat('pl-PL', {
                        timeZone: 'Europe/Warsaw',
                        dateStyle: 'short',
                        timeStyle: 'short',
                      }).format(item.closedAt)}
                      {item.undoneAt ? ' · Cofnięto' : ''}
                    </Text>
                  ))}
                </Stack>
              ))}
          </>
        )}
      </Stack>
    </Paper>
  );
}
