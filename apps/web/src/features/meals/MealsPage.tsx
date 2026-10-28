import { useState } from 'react';
import { Alert, Badge, Button, Checkbox, Group, Loader, Modal, Paper, Stack, Text, Title } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { copyMealWeekResponseSchema, mealWeekResponseSchema, type PutMeal } from '@rodzina/shared';
import { apiFetch } from '../../api.js';
import { useMe } from '../../sessionContext.js';
import { isOffline, useOffline } from '../../connectivity.js';
import { allowNavigation } from '../../nativeNavigation.js';
import { PageHeader } from '../../components/PageHeader.js';
import { SYNC_INTERVAL_MS } from '../../queryClient.js';
import { todayInTimezone } from '../calendar/toScheduleX.js';
import { MealForm } from './MealForm.js';
import { mealDateLabel, mealWeekStart, shiftMealDate } from './mealDates.js';
import './meals.css';

export function MealsPage() {
  const { user, family } = useMe();
  return <MealWeek key={`${family?.id}:${user?.id}`} />;
}

function MealWeek() {
  const { user, family, familyConfirmed } = useMe();
  const offline = useOffline();
  const client = useQueryClient();
  const today = todayInTimezone(family?.timezone ?? 'Europe/Warsaw');
  const [week, setWeek] = useState(() => mealWeekStart(today));
  const [editor, setEditor] = useState<string | null>(null);
  const [removal, setRemoval] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [notice, setNotice] = useState('');
  const account = `${family?.id}:${user?.id}`;
  const key = ['meals', family?.id, user?.id];
  const canEdit = !!user && user.role !== 'child';
  const writable = canEdit && familyConfirmed && !offline;
  const query = useQuery({
    queryKey: [...key, week],
    enabled: !!user && !!family && familyConfirmed && !offline,
    staleTime: 0,
    queryFn: async ({ signal }) =>
      mealWeekResponseSchema.parse(await apiFetch(`/api/meals?weekStart=${week}`, { signal })),
    refetchInterval: SYNC_INTERVAL_MS,
  });
  const mutation = useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async ({ path, method, data }: { path: string; method: string; data?: unknown }) => {
      if (!writable || isOffline()) throw new Error('Połącz się z internetem, aby zapisać zmiany.');
      return apiFetch(path, { method, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: key }),
        client.invalidateQueries({ queryKey: ['meal-suggestions', account] }),
      ]);
    },
  });
  const close = () => {
    if (mutation.isPending || (editor && !allowNavigation())) return;
    setEditor(null);
    setRemoval(null);
    setCopying(false);
    mutation.reset();
  };
  const changeWeek = (value: string) => {
    if (!allowNavigation()) return;
    setWeek(value);
    setNotice('');
  };
  const selected = query.data?.days.find((day) => day.date === editor)?.meals[0];
  const runAction = async () => {
    try {
      if (removal) {
        await mutation.mutateAsync({ path: `/api/meals/${removal}/dinner`, method: 'DELETE' });
        setNotice('Obiad został usunięty.');
        setRemoval(null);
      } else {
        const result = copyMealWeekResponseSchema.parse(
          await mutation.mutateAsync({
            path: '/api/meals/copy-week',
            method: 'POST',
            data: { fromWeekStart: shiftMealDate(week, -7), toWeekStart: week, overwrite },
          }),
        );
        setNotice(`Skopiowano obiadów: ${result.copied}.`);
        setCopying(false);
      }
    } catch {
      /* The dialog displays the mutation error. */
    }
  };
  return (
    <Stack className="meals-page">
      <PageHeader
        title="Obiady"
        description="Zaplanuj wspólne obiady na cały tydzień."
        actions={
          canEdit && (
            <Button
              variant="light"
              disabled={!writable || !query.data || query.isError}
              onClick={() => {
                mutation.reset();
                setOverwrite(false);
                setCopying(true);
                setNotice('');
              }}
            >
              Skopiuj poprzedni tydzień
            </Button>
          )
        }
      />
      {offline && (
        <Alert color="yellow" role="alert">
          Obiady są dostępne online. Połącz się z internetem, aby pobrać aktualny plan i zapisać zmiany.
        </Alert>
      )}
      <Group justify="space-between" className="meal-week-navigation">
        <Group gap="xs">
          <Button variant="default" aria-label="Poprzedni tydzień" onClick={() => changeWeek(shiftMealDate(week, -7))}>
            ‹
          </Button>
          <Button variant="default" onClick={() => changeWeek(mealWeekStart(today))}>
            Dziś
          </Button>
          <Button variant="default" aria-label="Następny tydzień" onClick={() => changeWeek(shiftMealDate(week, 7))}>
            ›
          </Button>
        </Group>
        <Text fw={600} aria-live="polite">
          {mealDateLabel(week)} – {mealDateLabel(shiftMealDate(week, 6))}
        </Text>
      </Group>
      {notice && (
        <Alert color="sage" role="status">
          {notice}
        </Alert>
      )}
      {!offline && query.isPending && (
        <Group role="status">
          <Loader size="sm" />
          <Text>Ładowanie obiadów…</Text>
        </Group>
      )}
      {!offline && query.isError && (
        <Alert color="red" title="Nie udało się pobrać planu obiadów" role="alert">
          <Text>Sprawdź połączenie i spróbuj ponownie.</Text>
          <Button variant="subtle" onClick={() => void query.refetch()}>
            Spróbuj ponownie
          </Button>
        </Alert>
      )}
      {!offline && !query.isError && query.data && (
        <div className="meal-week-grid">
          {query.data.days.map(({ date, meals }) => {
            const meal = meals[0];
            return (
              <Paper
                component="article"
                withBorder
                radius="lg"
                p="lg"
                key={date}
                className="meal-day"
                aria-label={mealDateLabel(date, true)}
              >
                <Stack h="100%">
                  <div>
                    <Title order={2} size="h4">
                      {mealDateLabel(date, true)}
                    </Title>
                    {date === today && <Badge mt="xs">Dziś</Badge>}
                  </div>
                  {meal ? (
                    <>
                      <Title order={3} size="h3">
                        {meal.title}
                      </Title>
                      {meal.notes && (
                        <Text className="meal-notes" size="sm">
                          {meal.notes}
                        </Text>
                      )}
                      {meal.ingredients.length > 0 && (
                        <ul className="meal-ingredients">
                          {meal.ingredients.map((item, index) => (
                            <li key={index}>
                              {item.name}
                              {item.quantity ? ` — ${item.quantity}` : ''}
                            </li>
                          ))}
                        </ul>
                      )}
                      {canEdit && (
                        <Group mt="auto" gap="xs">
                          <Button
                            variant="light"
                            disabled={!writable}
                            onClick={() => {
                              mutation.reset();
                              setNotice('');
                              setEditor(date);
                            }}
                            aria-label={`Edytuj obiad: ${mealDateLabel(date)}`}
                          >
                            Edytuj
                          </Button>
                          <Button
                            variant="subtle"
                            color="red"
                            disabled={!writable}
                            onClick={() => {
                              mutation.reset();
                              setRemoval(date);
                            }}
                            aria-label={`Usuń obiad: ${mealDateLabel(date)}`}
                          >
                            Usuń
                          </Button>
                        </Group>
                      )}
                    </>
                  ) : canEdit ? (
                    <Button
                      mt="auto"
                      variant="light"
                      disabled={!writable}
                      aria-label={`Dodaj obiad: ${mealDateLabel(date)}`}
                      onClick={() => {
                        mutation.reset();
                        setNotice('');
                        setEditor(date);
                      }}
                    >
                      ＋ Dodaj obiad
                    </Button>
                  ) : (
                    <Text c="dimmed">Brak zaplanowanego obiadu.</Text>
                  )}
                </Stack>
              </Paper>
            );
          })}
        </div>
      )}
      <Modal
        opened={editor !== null || removal !== null || copying}
        onClose={close}
        size="lg"
        title={
          editor
            ? `${selected ? 'Edytuj obiad' : 'Dodaj obiad'} — ${mealDateLabel(editor)}`
            : removal
              ? 'Usuń obiad'
              : 'Skopiuj poprzedni tydzień'
        }
        closeOnClickOutside={!mutation.isPending}
        closeOnEscape={!mutation.isPending}
        closeButtonProps={{ disabled: mutation.isPending, 'aria-label': 'Zamknij formularz' }}
      >
        {editor && (
          <MealForm
            key={editor}
            meal={selected}
            account={account}
            disabled={!writable}
            pending={mutation.isPending}
            onCancel={() => setEditor(null)}
            onSave={async (data: PutMeal) => {
              await mutation.mutateAsync({ path: `/api/meals/${editor}/dinner`, method: 'PUT', data });
              setNotice('Obiad został zapisany.');
            }}
          />
        )}
        {!editor && (
          <Stack>
            <Text>
              {removal
                ? 'Czy usunąć zaplanowany obiad wraz ze składnikami?'
                : `Skopiować obiady z tygodnia ${mealDateLabel(shiftMealDate(week, -7))} do tygodnia ${mealDateLabel(week)}?`}
            </Text>
            {copying && (
              <Checkbox
                label="Nadpisz istniejące obiady"
                description="Bez zaznaczenia skopiujemy tylko obiady na wolne dni. Pozostałe dni nie zmienią się."
                checked={overwrite}
                disabled={mutation.isPending}
                onChange={(event) => setOverwrite(event.currentTarget.checked)}
              />
            )}
            {mutation.isError && (
              <Alert role="alert" color="red">
                {mutation.error.message}
              </Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" disabled={mutation.isPending} onClick={close}>
                Anuluj
              </Button>
              <Button
                color={removal ? 'red' : 'sage'}
                loading={mutation.isPending}
                disabled={!writable}
                onClick={() => void runAction()}
              >
                {removal ? 'Usuń' : 'Kopiuj'}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
