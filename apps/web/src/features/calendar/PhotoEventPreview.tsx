import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Group, Progress, Stack, Text, Title } from '@mantine/core';
import { parseOcrEvents, type OcrParseResult } from '@rodzina/shared';
import { PageHeader } from '../../components/PageHeader.js';
import { getSessionGeneration } from '../../platform.js';
import { registerAccountStore } from '../../accountStorage.js';
import { prepareOcrImage } from './ocrImage.js';
import { recognizeOcrImage } from './ocrWeb.js';

export function PhotoEventPreview({ onClose }: { onClose: () => void }) {
  const [preview, setPreview] = useState<string>();
  const [result, setResult] = useState<OcrParseResult>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ message: '', value: 0 });
  const current = useRef<{ controller: AbortController; url: string | undefined }>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const clear = useCallback(() => {
    current.current?.controller.abort();
    if (current.current?.url) URL.revokeObjectURL(current.current.url);
    current.current = undefined;
  }, []);
  useEffect(() => {
    const unregister = registerAccountStore({
      name: 'calendar-photo-preview',
      phase: 'before-invalidation',
      clear: () => {
        clear();
        setPreview(undefined);
        setResult(undefined);
        setError(undefined);
        setBusy(false);
        setProgress({ message: '', value: 0 });
      },
    });
    return () => {
      unregister();
      clear();
    };
  }, [clear]);
  const cancel = () => {
    clear();
    setBusy(false);
    setPreview(undefined);
    setResult(undefined);
    setError(undefined);
    setProgress({ message: 'Odczyt anulowany. Możesz wybrać inne zdjęcie.', value: 0 });
  };
  const select = async (file: File) => {
    clear();
    setPreview(undefined);
    setResult(undefined);
    setError(undefined);
    setBusy(true);
    setProgress({ message: 'Przygotowanie zdjęcia', value: 0 });
    const run = { controller: new AbortController(), url: undefined as string | undefined };
    current.current = run;
    const generation = getSessionGeneration();
    const active = () =>
      current.current === run && generation === getSessionGeneration() && !run.controller.signal.aborted;
    try {
      const image = await prepareOcrImage(file, run.controller.signal);
      if (!active()) return;
      run.url = URL.createObjectURL(image.blob);
      setPreview(run.url);
      const document = await recognizeOcrImage(image, run.controller.signal, (message, value) => {
        if (active()) setProgress({ message, value });
      });
      if (active()) setResult(parseOcrEvents(document, { groupByDates: true }));
    } catch (reason) {
      if (active()) setError(reason instanceof Error ? reason.message : 'Nie udało się odczytać zdjęcia.');
    } finally {
      if (active()) setBusy(false);
    }
  };
  return (
    <Stack gap="lg">
      <Button variant="subtle" onClick={onClose} style={{ alignSelf: 'flex-start' }}>
        Wróć do kalendarza
      </Button>
      <PageHeader title="Dodaj ze zdjęcia" description="Odczytaj terminy z plakatu lub ogłoszenia." />
      <Alert>
        Zdjęcie odczytujemy na tym urządzeniu i nie wysyłamy go na serwer. To podgląd propozycji — zapis do kalendarza
        nie jest jeszcze dostępny.
      </Alert>
      <Stack gap="xs">
        <Button variant="default" mih={44} onClick={() => input.current?.click()} style={{ alignSelf: 'flex-start' }}>
          Wybierz zdjęcie
        </Button>
        <input
          ref={input}
          id="event-photo"
          aria-label="Wybierz zdjęcie"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void select(file);
          }}
          style={{ display: 'none' }}
        />
        <Text size="sm" c="dimmed">
          JPEG, PNG lub WebP, do 20 MB. Najlepiej użyć wyraźnego zdjęcia z prostym tekstem.
        </Text>
      </Stack>
      <div role="status" aria-live="polite">
        {busy
          ? `${progress.message}… ${progress.value}%`
          : result
            ? `Odczyt zakończony. Propozycje: ${result.proposals.length}.`
            : progress.message}
      </div>
      {busy && (
        <>
          <Progress value={progress.value} aria-label="Postęp odczytu zdjęcia" />
          <Button variant="default" onClick={cancel}>
            Anuluj odczyt
          </Button>
        </>
      )}
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      {preview && (
        <img
          src={preview}
          alt="Podgląd wybranego zdjęcia"
          style={{ maxWidth: '100%', maxHeight: 480, objectFit: 'contain', borderRadius: 12 }}
        />
      )}
      {result && (
        <Stack>
          <Title order={2}>Propozycje wydarzeń</Title>
          {result.proposals.length === 0 && (
            <Alert color="yellow">
              Nie rozpoznano propozycji wydarzeń. Wybierz wyraźniejsze zdjęcie z datą i tytułem.
            </Alert>
          )}
          {result.warnings.map((warning, index) => (
            <Alert color="yellow" key={`${warning.code}-${index}`}>
              {warning.message}
            </Alert>
          ))}
          {result.proposals.map((proposal, index) => (
            <Card key={index} withBorder padding="md" style={{ overflowWrap: 'anywhere' }}>
              <Stack gap="sm">
                <Title order={3}>{proposal.title ?? `Propozycja ${index + 1} — brak tytułu`}</Title>
                <Group gap="lg">
                  <Text>
                    Data:{' '}
                    {proposal.dateRange
                      ? `${proposal.dateRange.start.isoDate ?? `${proposal.dateRange.start.day}.${String(proposal.dateRange.start.month).padStart(2, '0')}`} – ${proposal.dateRange.end.isoDate ?? `${proposal.dateRange.end.day}.${String(proposal.dateRange.end.month).padStart(2, '0')}`} (włącznie)${proposal.dateRange.start.year === null ? ' — rok wymaga potwierdzenia' : ''}`
                      : (proposal.startDate ??
                        (proposal.dates.length === 1 && proposal.dates[0]!.valid && proposal.dates[0]!.year === null
                          ? `${proposal.dates[0]!.day}.${String(proposal.dates[0]!.month).padStart(2, '0')} (rok wymaga potwierdzenia)`
                          : 'wymaga potwierdzenia'))}
                  </Text>
                  <Text>
                    {proposal.openingHours ? (
                      `Godziny otwarcia: ${proposal.openingHours.startTime}–${proposal.openingHours.endTime}`
                    ) : (
                      <>
                        Godzina:{' '}
                        {proposal.startTime
                          ? `${proposal.startTime}${proposal.endTime ? `–${proposal.endTime}` : ''}`
                          : 'wymaga potwierdzenia'}
                      </>
                    )}
                  </Text>
                </Group>
                {proposal.dates.length > 0 && (
                  <Text size="sm">
                    Rozpoznane daty: {[...new Set(proposal.dates.map((date) => date.text))].join(', ')}
                  </Text>
                )}
                {proposal.location && <Text>Miejsce: {proposal.location}</Text>}
                {proposal.warnings.map((warning, warningIndex) => (
                  <Alert color="yellow" key={`${warning.code}-${warningIndex}`}>
                    {warning.message}
                  </Alert>
                ))}
                <Text fw={600} size="sm">
                  Tekst źródłowy
                </Text>
                <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                  {proposal.source.map((line) => line.text).join('\n')}
                </Text>
              </Stack>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
