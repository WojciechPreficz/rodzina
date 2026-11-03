import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Temporal } from 'temporal-polyfill';
import { Alert, Button, Card, Checkbox, Group, Modal, Stack, Text } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import {
  importEventsResponseSchema,
  importEventSchema,
  localDateTimeToUtc,
  type EventData,
  type Member,
  type OcrParseResult,
  type OcrEventProposal,
  type EventDuplicateResolution,
} from '@rodzina/shared';
import { apiFetch } from '../../api.js';
import { getSessionGeneration } from '../../platform.js';
import { registerAccountStore } from '../../accountStorage.js';
import { useFormNavigation } from '../../useFormNavigation.js';
import { allowNavigation } from '../../nativeNavigation.js';
import { isOffline } from '../../connectivity.js';
import { useCalendarReadOnly } from './calendarQueries.js';
import { calendarStore } from './calendarOffline.js';
import { refreshLocalSchedule } from '../notifications/scheduleSync.js';
import { EventForm } from './EventForm.js';
import { readPhotoImports, writePhotoImports, type PhotoImportOperation } from './photoImportStorage.js';
import { EventDuplicateDialog } from './EventDuplicateDialog.js';

type Row = {
  id: string;
  proposal?: OcrEventProposal;
  approved?: EventData;
  selected: boolean;
  operation?: PhotoImportOperation;
};

function recognizedEvent(proposal: OcrEventProposal | undefined, timezone: string): EventData | undefined {
  if (
    !proposal ||
    proposal.warnings.some(({ code }) =>
      [
        'MISSING_DATE',
        'MISSING_YEAR',
        'INVALID_DATE',
        'AMBIGUOUS_DATE',
        'REGISTRATION_DATE',
        'INVALID_TIME',
        'AMBIGUOUS_TIME',
        'AMBIGUOUS_LAYOUT',
      ].includes(code),
    )
  )
    return;
  try {
    let durationMinutes = proposal.durationMinutes;
    if (proposal.dateRange) {
      const start = proposal.dateRange.start.isoDate;
      const end = proposal.dateRange.end.isoDate;
      if (!start || !end) return;
      if (proposal.startTime) {
        if (!proposal.endTime) return;
        durationMinutes =
          (localDateTimeToUtc(end, proposal.endTime, timezone) -
            localDateTimeToUtc(start, proposal.startTime, timezone)) /
          60000;
      } else durationMinutes = (Temporal.PlainDate.from(start).until(Temporal.PlainDate.from(end)).days + 1) * 1440;
    }
    const parsed = importEventSchema.safeParse({
      title: proposal.title,
      startDate: proposal.startDate,
      startTime: proposal.startTime,
      durationMinutes,
      location: proposal.location,
      participantIds: [],
      kind: 'single',
    });
    return parsed.success ? parsed.data : undefined;
  } catch {
    return;
  }
}

export function PhotoImportReview({
  result,
  members,
  timezone,
  initialDate,
  renderSource,
}: {
  result: OcrParseResult | undefined;
  members: Member[];
  timezone: string;
  initialDate: string;
  renderSource: (proposal: OcrEventProposal, index: number) => ReactNode;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [editing, setEditing] = useState<Row>();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const [duplicateId, setDuplicateId] = useState<string>();
  const sending = useRef(false);
  const discarded = useRef(false);
  const revision = useRef(0);
  const lastResult = useRef<OcrParseResult>(undefined);
  const client = useQueryClient();
  const readOnly = useCalendarReadOnly();
  const dirty = rows.some((row) => !row.operation || row.operation.result?.status === 'error');
  useFormNavigation({
    isDirty: () => !discarded.current && (dirty || busy),
    discard: () => {
      discarded.current = true;
    },
  });
  useEffect(() => {
    discarded.current = false;
  }, [rows, busy]);
  useEffect(() => {
    const fence = revision;
    const version = ++fence.current;
    const generation = getSessionGeneration();
    const active = () => fence.current === version && generation === getSessionGeneration();
    void readPhotoImports()
      .then((operations) => {
        if (!active()) return;
        setRows((current) => [
          ...operations.map((operation) => ({
            id: operation.operationId,
            approved: operation.event,
            selected: false,
            operation,
          })),
          ...current,
        ]);
        setReady(true);
        setDuplicateId(
          operations.find((operation) => operation.result?.status === 'error' && operation.result.error.duplicates)
            ?.operationId,
        );
      })
      .catch(() => {
        if (active())
          setError('Nie można odczytać zapisanych operacji. Otwórz ponownie ekran po przywróceniu pamięci.');
      });
    const unregister = registerAccountStore({
      name: 'calendar-photo-import-view',
      phase: 'before-invalidation',
      clear: () => {
        fence.current++;
        setRows([]);
        setEditing(undefined);
        setReady(false);
        setError(undefined);
        setBusy(false);
        setDuplicateId(undefined);
      },
    });
    return () => {
      fence.current++;
      unregister();
    };
  }, []);
  useEffect(() => {
    if (lastResult.current !== result) {
      lastResult.current = result;
      if (!result) {
        setEditing(undefined);
        setDuplicateId(undefined);
      }
      setRows((current) => [
        ...current.filter((row) => row.operation && (!row.operation.result || row.operation.result.status === 'error')),
        ...(result?.proposals ?? []).map((proposal) => ({ id: crypto.randomUUID(), proposal, selected: false })),
      ]);
    }
  }, [result]);

  const selected = rows.filter(
    (row) => row.selected && row.approved && (!row.operation || row.operation.result?.status === 'error'),
  );
  const unknown = rows.filter((row) => row.operation && !row.operation.result);
  async function send(targets: Row[], resolution?: EventDuplicateResolution) {
    if (sending.current || readOnly || isOffline() || !ready || !targets.length || targets.length > 20) return;
    sending.current = true;
    setBusy(true);
    setError(undefined);
    setDuplicateId(undefined);
    const version = revision.current;
    const generation = getSessionGeneration();
    const active = () => revision.current === version && generation === getSessionGeneration();
    try {
      const operations = targets.map((row) =>
        row.operation && !row.operation.result
          ? row.operation
          : {
              operationId: crypto.randomUUID(),
              event: importEventSchema.parse(row.approved),
              duplicateResolution: resolution ?? { action: 'check' as const },
            },
      );
      // A failed commit must prevent the request, even when the browser still has the form in memory.
      await writePhotoImports(
        operations,
        targets.flatMap((row) => (row.operation?.result?.status === 'error' ? [row.operation.operationId] : [])),
      );
      if (!active()) return;
      setRows((current) =>
        current.map((row) => {
          const index = targets.findIndex((target) => target.id === row.id);
          return index < 0 ? row : { ...row, selected: false, operation: operations[index]! };
        }),
      );
      if (isOffline()) throw new Error('Utracono połączenie. Ponów zapis online.');
      const response = importEventsResponseSchema.parse(
        await apiFetch('/api/events/import', {
          method: 'POST',
          body: JSON.stringify({
            items: operations.map(({ operationId, event, duplicateResolution }) => ({
              operationId,
              event,
              ...(duplicateResolution ? { duplicateResolution } : {}),
            })),
          }),
        }),
      );
      if (!active()) return;
      const results = new Map(response.results.map((result) => [result.operationId, result]));
      if (results.size !== operations.length || operations.some((operation) => !results.has(operation.operationId)))
        throw new Error('Niepełna odpowiedź importu. Ponów te same operacje.');
      const settled = operations.map((operation) => ({ ...operation, result: results.get(operation.operationId)! }));
      try {
        await writePhotoImports(settled);
        if (!active()) return;
        setRows((current) =>
          current.map((row) => {
            const operation = settled.find((operation) => operation.operationId === row.operation?.operationId);
            return operation ? { ...row, operation } : row;
          }),
        );
        const duplicate = settled.find(
          (operation) => operation.result.status === 'error' && operation.result.error.duplicates,
        );
        if (duplicate)
          setDuplicateId(
            targets[operations.findIndex((operation) => operation.operationId === duplicate.operationId)]?.id,
          );
      } finally {
        if (active() && settled.some((operation) => operation.result.status !== 'error')) {
          calendarStore.markStale();
          await Promise.all([client.invalidateQueries({ queryKey: ['calendar'] }), refreshLocalSchedule(client)]);
        }
      }
    } catch (cause) {
      if (active())
        setError(
          `Nie udało się zakończyć zapisu. Wysłane pozycje o nieznanym wyniku pozostają zablokowane; ponów je bez zmiany danych. ${cause instanceof Error ? cause.message : ''}`,
        );
    } finally {
      if (active()) {
        sending.current = false;
        setBusy(false);
      }
    }
  }
  async function discard(row: Row) {
    if (busy || (row.operation && !row.operation.result)) return;
    const version = revision.current;
    try {
      if (row.operation) await writePhotoImports([], [row.operation.operationId]);
      if (version === revision.current) setRows((current) => current.filter((item) => item.id !== row.id));
    } catch {
      if (version === revision.current) setError('Nie można usunąć zapisanej pozycji z pamięci.');
    }
  }
  const saved = rows.filter((row) => row.operation?.result && row.operation.result.status !== 'error').length;
  const duplicateRow = rows.find((row) => row.id === duplicateId);
  const duplicateResult = duplicateRow?.operation?.result;
  return (
    <Stack>
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      <Text>
        Zatwierdź rozpoznane dane lub popraw propozycję. Przed zapisem sprawdź zaznaczone wydarzenia. Brak godziny nie
        blokuje zatwierdzenia. Maksymalnie 20 wydarzeń w paczce.
      </Text>
      {readOnly && <Alert>Dostępne po połączeniu z internetem i potwierdzeniu dostępu do rodziny.</Alert>}
      {selected.length > 20 && <Alert color="yellow">Wybierz najwyżej 20 wydarzeń do jednej paczki.</Alert>}
      <Group>
        <Button disabled={!ready || busy} onClick={() => setEditing({ id: crypto.randomUUID(), selected: false })}>
          Dodaj ręcznie propozycję
        </Button>
        <Button
          disabled={!ready || busy || readOnly || !selected.length || selected.length > 20}
          loading={busy}
          onClick={() => void send(selected)}
        >
          Zapisz wybrane ({selected.length}/20)
        </Button>
        {unknown.length > 0 && (
          <Button disabled={!ready || busy || readOnly} onClick={() => void send(unknown.slice(0, 20))}>
            Ponów nieznane wyniki ({unknown.length})
          </Button>
        )}
      </Group>
      <Text aria-live="polite">
        Zapisane: {saved}. Wymagają poprawy: {rows.filter((row) => row.operation?.result?.status === 'error').length}.
        Nieznany wynik: {unknown.length}.
      </Text>
      {rows.map((row, index) => {
        const outcome = row.operation?.result;
        const locked = !!row.operation && outcome?.status !== 'error';
        const recognized = !row.approved ? recognizedEvent(row.proposal, timezone) : undefined;
        return (
          <Card key={row.id} withBorder padding="md" style={{ overflowWrap: 'anywhere' }}>
            <Stack gap="sm">
              {row.proposal ? (
                renderSource(row.proposal, index)
              ) : (
                <Text fw={600}>{row.approved?.title ?? 'Nowa propozycja'}</Text>
              )}
              {row.approved && (
                <Text>
                  Zatwierdzone: {row.approved.title}, {row.approved.startDate},{' '}
                  {row.approved.startTime ?? 'bez godziny'}
                </Text>
              )}
              {row.operation && (
                <Alert color={outcome?.status === 'error' ? 'red' : outcome ? 'green' : 'yellow'}>
                  {!outcome
                    ? 'Nieznany wynik — dane zamrożone. Ponów tę samą operację online.'
                    : outcome.status === 'error'
                      ? `Wymaga poprawy: ${outcome.error.message}`
                      : outcome.status === 'created'
                        ? row.operation.duplicateResolution?.action === 'replace'
                          ? 'Zastąpiono istniejące wydarzenie.'
                          : 'Zapisano w kalendarzu.'
                        : 'Już zapisano wcześniej — bez duplikatu.'}
                </Alert>
              )}
              <Checkbox
                label={`Wybierz do zapisu: ${row.approved?.title ?? row.proposal?.title ?? index + 1}`}
                disabled={!row.approved || locked || busy}
                checked={row.selected}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setRows((current) =>
                    current.map((item) => (item.id === row.id ? { ...item, selected: checked } : item)),
                  );
                }}
              />
              <Group>
                {outcome?.status === 'error' && outcome.error.duplicates && (
                  <Button
                    variant="default"
                    disabled={busy || !ready || readOnly}
                    onClick={() => setDuplicateId(row.id)}
                  >
                    Rozstrzygnij duplikat
                  </Button>
                )}
                {recognized && (
                  <Button
                    variant="default"
                    disabled={locked || busy || !ready || readOnly}
                    onClick={() => {
                      setRows((current) =>
                        current.map((item) =>
                          item.id === row.id ? { ...item, approved: recognized, selected: true } : item,
                        ),
                      );
                    }}
                  >
                    Zatwierdź propozycję
                  </Button>
                )}
                <Button variant="default" disabled={locked || busy || !ready} onClick={() => setEditing(row)}>
                  {row.approved ? 'Popraw propozycję' : 'Popraw i zatwierdź'}
                </Button>
                <Button
                  variant="subtle"
                  disabled={busy || (!!row.operation && !outcome)}
                  onClick={() => void discard(row)}
                >
                  {outcome && outcome.status !== 'error' ? 'Ukryj wynik' : 'Odrzuć propozycję'}
                </Button>
              </Group>
            </Stack>
          </Card>
        );
      })}
      <EventDuplicateDialog
        opened={!!duplicateRow}
        title={duplicateRow?.approved?.title ?? ''}
        date={duplicateRow?.approved?.startDate ?? ''}
        duplicates={duplicateResult?.status === 'error' ? (duplicateResult.error.duplicates ?? []) : []}
        pending={busy}
        onClose={() => setDuplicateId(undefined)}
        onResolve={(resolution) => {
          if (duplicateRow) void send([duplicateRow], resolution);
        }}
      />
      <Modal
        opened={!!editing}
        onClose={() => {
          if (allowNavigation()) setEditing(undefined);
        }}
        title="Zatwierdź propozycję wydarzenia"
        size="xl"
        returnFocus
      >
        {editing && (
          <Stack>
            {editing.proposal && renderSource(editing.proposal, 0)}
            <Text>
              Sprawdź datę i rok. Godzina i czas trwania są opcjonalne; bez godziny wydarzenie jest przypisane do dnia,
              bez określania pory. Zatwierdzenie nie zapisuje jeszcze wydarzenia.
            </Text>
            <EventForm
              key={editing.id}
              members={members}
              timezone={timezone}
              initialDate={initialDate}
              pending={false}
              readOnly={readOnly}
              approval={{
                label: 'Zatwierdź do paczki',
                initial: editing.approved ?? {
                  title: editing.proposal?.title ?? '',
                  location: editing.proposal?.location ?? null,
                  ...(editing.proposal?.startDate ? { startDate: editing.proposal.startDate } : {}),
                  ...(editing.proposal?.startTime ? { startTime: editing.proposal.startTime } : {}),
                  ...(editing.proposal?.durationMinutes ? { durationMinutes: editing.proposal.durationMinutes } : {}),
                },
                ...(!editing.approved && editing.proposal?.dateRange
                  ? { endDate: editing.proposal.dateRange.end.isoDate ?? '' }
                  : {}),
              }}
              onCancel={() => {
                if (allowNavigation()) setEditing(undefined);
              }}
              onSave={async (data) => {
                const approved = importEventSchema.parse(data);
                const row = { ...editing, approved, selected: false };
                setRows((current) =>
                  current.some((item) => item.id === row.id)
                    ? current.map((item) => (item.id === row.id ? row : item))
                    : [...current, row],
                );
                setEditing(undefined);
              }}
            />
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
