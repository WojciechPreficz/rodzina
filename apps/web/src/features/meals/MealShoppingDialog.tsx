import { useEffect, useRef, useState } from 'react';
import { Alert, Anchor, Button, Checkbox, Group, Loader, Modal, Select, Stack, Text } from '@mantine/core';
import { Link } from 'react-router';
import { type Meal } from '@rodzina/shared';
import { ApiRequestError } from '../../api.js';
import { useOffline } from '../../connectivity.js';
import { useMe } from '../../sessionContext.js';
import { useShopping } from '../shopping/shoppingQueries.js';
import { queueMealExport, useMealState, confirmMealExport } from './mealOffline.js';
import { mealDateLabel } from './mealDates.js';
import { addNativeBackHandler } from '../../nativeNavigation.js';

export function MealShoppingDialog({ week, meals, onClose }: { week: string; meals: Meal[]; onClose: () => void }) {
  const { user } = useMe();
  const offline = useOffline();
  const [listId, setListId] = useState<string | null>(null);
  const [mealIds, setMealIds] = useState(meals.filter((meal) => meal.ingredients.length).map((meal) => meal.id));
  const [attempt, setAttempt] = useState<string | null>(null);
  const [repeat, setRepeat] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  useEffect(
    () =>
      addNativeBackHandler(() => {
        if (!sending.current) onClose();
      }),
    [onClose],
  );
  const [error, setError] = useState('');
  const state = useMealState();
  const shopping = useShopping(listId);
  const lists = shopping.lists;
  const result = attempt ? state.cache.results[attempt] : undefined;
  const operation = state.operations.find((op) => op.operationId === attempt);
  const needsConfirmation = operation?.reviewReason === 'MEAL_EXPORT_CONFIRMATION_REQUIRED';
  const repeated = repeat || needsConfirmation;
  const queued = !!attempt && !result && !repeated;
  const writable = !!user && user.role !== 'child' && state.ready;
  const send = async () => {
    if (sending.current || !writable || !listId || !mealIds.length || (repeated && !confirmed)) return;
    sending.current = true;
    setPending(true);
    setError('');
    try {
      if (attempt && needsConfirmation) await confirmMealExport(attempt);
      else {
        const saved = await queueMealExport(week, listId, mealIds, confirmed);
        setAttempt(saved.operationId);
      }
      setRepeat(false);
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.code === 'MEAL_EXPORT_CONFIRMATION_REQUIRED') {
        setRepeat(true);
      } else {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Nie udało się potwierdzić eksportu. Spróbuj ponownie z tym samym wyborem — ilości nie zostaną dodane podwójnie.',
        );
      }
    } finally {
      sending.current = false;
      setPending(false);
    }
  };
  return (
    <Modal
      opened
      onClose={() => {
        if (!sending.current) onClose();
      }}
      title="Dodaj składniki do listy zakupów"
      size="lg"
      closeOnClickOutside={!pending}
      closeOnEscape={!pending}
      closeButtonProps={{ disabled: pending, 'aria-label': 'Zamknij eksport' }}
    >
      <Stack>
        {result || queued ? (
          <>
            <Alert color="sage" role="status">
              {result
                ? `Dodano pozycji: ${result.added}. Uzupełniono pozycji: ${result.updated}.`
                : operation?.status === 'needs-review'
                  ? `Eksport wymaga sprawdzenia: ${operation.lastError}`
                  : 'Eksport zapisany na urządzeniu. Oczekuje na synchronizację.'}
            </Alert>
            <Text size="sm">Późniejsze zmiany obiadów nie zmieniają listy zakupów.</Text>
            <Anchor component={Link} to={`/zakupy?lista=${listId}`} onClick={onClose}>
              Przejdź do zakupów
            </Anchor>
            <Button onClick={onClose}>Gotowe</Button>
          </>
        ) : (
          <>
            <Text size="sm">
              Wybierz dania i listę. Składniki o tej samej nazwie połączymy z niekupionymi pozycjami, sumując ilości
              tekstowo. Kupione pozycje pozostaną bez zmian.
            </Text>
            {!writable && (
              <Alert color="yellow">Pamięć obiadów nie jest gotowa lub nie masz uprawnień do zapisu.</Alert>
            )}
            {lists.isPending && !offline && <Loader size="sm" aria-label="Ładowanie list zakupów" />}
            {lists.isError && (
              <Alert color="red" role="alert">
                Nie udało się pobrać list zakupów.
                <Button variant="subtle" onClick={() => void lists.refetch()}>
                  Spróbuj ponownie
                </Button>
              </Alert>
            )}
            {lists.data?.length === 0 && (
              <Text>Nie masz listy zakupów. Utwórz ją w zakładce Zakupy i wróć do eksportu.</Text>
            )}
            <Select
              label="Lista zakupów"
              placeholder="Wybierz listę"
              data={(lists.data ?? []).map((list) => ({ value: list.id, label: list.name }))}
              value={listId}
              onChange={setListId}
              disabled={!writable || !!attempt}
            />
            <Checkbox.Group label="Obiady do eksportu" value={mealIds} onChange={setMealIds}>
              <Stack gap="sm" mt="xs">
                {meals.map((meal) => (
                  <Checkbox
                    key={meal.id}
                    value={meal.id}
                    label={`${mealDateLabel(meal.date)} — ${meal.title}`}
                    description={!meal.ingredients.length ? 'Brak składników' : undefined}
                    disabled={!writable || !!attempt || !meal.ingredients.length}
                  />
                ))}
              </Stack>
            </Checkbox.Group>
            {repeated && (
              <Alert color="yellow" role="alert">
                Co najmniej jeden wybrany obiad był już eksportowany na tę listę. Ponowny eksport jeszcze raz doda
                ilości wszystkich wybranych dań.
                <Checkbox
                  mt="sm"
                  label="Potwierdzam ponowne dodanie ilości"
                  checked={confirmed}
                  disabled={pending}
                  onChange={(event) => setConfirmed(event.currentTarget.checked)}
                />
              </Alert>
            )}
            {error && (
              <Alert color="red" role="alert">
                {error}
              </Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" disabled={pending} onClick={onClose}>
                Anuluj
              </Button>
              <Button
                loading={pending}
                disabled={
                  !writable ||
                  !listId ||
                  !mealIds.length ||
                  (!attempt &&
                    (!lists.data?.some((list) => list.id === listId) ||
                      !shopping.items.data ||
                      shopping.active?.id !== listId)) ||
                  (repeated && !confirmed)
                }
                onClick={() => void send()}
              >
                {repeated ? 'Dodaj ponownie' : error ? 'Ponów eksport' : 'Dodaj składniki'}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
