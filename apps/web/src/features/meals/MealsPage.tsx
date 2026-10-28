import { useState } from 'react';
import { Alert, Badge, Button, Checkbox, Group, Loader, Modal, Paper, Stack, Text, Title } from '@mantine/core';
import { useMutation } from '@tanstack/react-query';
import { type Meal, type PutMeal } from '@rodzina/shared';
import { useMe } from '../../sessionContext.js';
import { useOffline } from '../../connectivity.js';
import { OfflineNotice } from '../../offline/OfflineNotice.js';
import { queueMeal, queueMealCopy, useMealState, confirmMealExport, discardMealOperation } from './mealOffline.js';
import { allowNavigation } from '../../nativeNavigation.js';
import { PageHeader } from '../../components/PageHeader.js';
import { todayInTimezone } from '../calendar/toScheduleX.js';
import { MealForm } from './MealForm.js';
import { MealShoppingDialog } from './MealShoppingDialog.js';
import { useMealWeek } from './mealQueries.js';
import { mealDateLabel, mealWeekStart, shiftMealDate } from './mealDates.js';
import './meals.css';

export function MealsPage() {
  const { user, family } = useMe();
  return <MealWeek key={`${family?.id}:${user?.id}`} />;
}

function MealWeek() {
  const { user, family } = useMe();
  const offline = useOffline();
  const savedState = useMealState();
  const today = todayInTimezone(family?.timezone ?? 'Europe/Warsaw');
  const [week, setWeek] = useState(() => mealWeekStart(today));
  const [editor, setEditor] = useState<string | null>(null);
  const [removal, setRemoval] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [notice, setNotice] = useState('');
  const [exportMeals, setExportMeals] = useState<Meal[] | null>(null);
  const account = `${family?.id}:${user?.id}`;
  const canEdit = !!user && user.role !== 'child';
  const query = useMealWeek(week);
  const previousWeek = useMealWeek(shiftMealDate(week, -7), canEdit);
  const writable = canEdit && query.ready && !!query.data;
  const mutation = useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async (action: { date: string; data: PutMeal | null } | { overwrite: boolean }) =>
      'date' in action ? queueMeal(action.date, action.data) : queueMealCopy(week, action.overwrite),
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
        await mutation.mutateAsync({ date: removal, data: null });
        setNotice('Obiad został usunięty.');
        setRemoval(null);
      } else {
        const result = await mutation.mutateAsync({ overwrite });
        setNotice(`Skopiowano obiadów: ${result.type === 'write' ? result.writes.length : 0}.`);
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
            <Group gap="xs" className="meal-week-actions">
              <Button
                disabled={
                  !writable || !query.data?.days.some((day) => day.meals.some((meal) => meal.ingredients.length))
                }
                onClick={() => setExportMeals(query.data!.days.flatMap((day) => day.meals))}
              >
                Dodaj składniki do listy zakupów
              </Button>
              <Button
                variant="light"
                disabled={!writable || !previousWeek.data}
                onClick={() => {
                  mutation.reset();
                  setOverwrite(false);
                  setCopying(true);
                  setNotice('');
                }}
              >
                Skopiuj poprzedni tydzień
              </Button>
            </Group>
          )
        }
      />
      <OfflineNotice offline={offline} syncedAt={query.syncedAt} issue={query.status.storageIssue}>
        Zapisane tygodnie można przeglądać i zmieniać. Zmiany wyślemy po odzyskaniu połączenia.
      </OfflineNotice>
      {query.status.pendingCount > 0 && (
        <Text role="status">Oczekujące zmiany obiadów: {query.status.pendingCount}.</Text>
      )}
      {query.status.reviewCount > 0 && (
        <Alert color="red" role="alert">
          Zmiany wymagają sprawdzenia i zostały zachowane na urządzeniu. {query.status.lastError}
          {savedState.operations
            .filter((op) => op.status === 'needs-review')
            .map((op) => (
              <Stack key={op.operationId} gap="xs" mt="sm">
                <Text size="sm">
                  {op.payload.type === 'write'
                    ? op.payload.writes
                        .map(
                          (write) =>
                            `${write.date}: ${write.data?.title ?? 'usunięcie obiadu'}${write.data ? ` — ${write.data.ingredients.map((item) => `${item.name} ${item.quantity ?? ''}`).join(', ')}` : ''}`,
                        )
                        .join(', ')
                    : `Eksport: ${(op.payload.data.snapshot ?? []).map((meal) => `${meal.date}: ${meal.ingredients.map((item) => `${item.name} ${item.quantity ?? ''}`).join(', ')}`).join('; ')}`}
                  . {op.lastError}
                </Text>
                {op.payload.type === 'export' &&
                  !op.payload.data.confirmRepeat &&
                  op.reviewReason === 'MEAL_EXPORT_CONFIRMATION_REQUIRED' && (
                    <Button
                      onClick={() =>
                        void confirmMealExport(op.operationId).catch((error: Error) => setNotice(error.message))
                      }
                    >
                      Potwierdź ponowne dodanie ilości
                    </Button>
                  )}
                <Button
                  variant="subtle"
                  color="red"
                  onClick={() => {
                    if (
                      window.confirm(
                        'Odrzucić tę zmianę i późniejsze zależne zmiany obiadów oraz zakupów? Te zmiany zostaną usunięte z urządzenia.',
                      )
                    )
                      void discardMealOperation(op.operationId).catch((error: Error) => setNotice(error.message));
                  }}
                >
                  Odrzuć zmianę i zależne zmiany
                </Button>
              </Stack>
            ))}
        </Alert>
      )}
      {query.ready && !query.data && (offline || query.isError) && (
        <Alert color="yellow" role="alert">
          Ten tydzień nie został pobrany. Połącz się z internetem, aby poznać jego zawartość.
        </Alert>
      )}
      {offline && query.data && !previousWeek.data && canEdit && (
        <Text size="sm" c="dimmed">
          Poprzedni tydzień nie jest zapisany. Połącz się z internetem, aby pobrać go przed kopiowaniem.
        </Text>
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
      {query.data && (
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
              await mutation.mutateAsync({ date: editor, data });
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
      {exportMeals && <MealShoppingDialog week={week} meals={exportMeals} onClose={() => setExportMeals(null)} />}
    </Stack>
  );
}
