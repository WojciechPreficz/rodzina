import { useEffect, useRef, useState } from 'react';
import { Alert, Anchor, Button, Checkbox, Group, Loader, Modal, Select, Stack, Text } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { mealsToShoppingListResponseSchema, shoppingListsResponseSchema, type Meal } from '@rodzina/shared';
import { ApiRequestError, apiFetch } from '../../api.js';
import { isOffline, useOffline } from '../../connectivity.js';
import { useMe } from '../../sessionContext.js';
import { shoppingKey } from '../shopping/shoppingOptimistic.js';
import { mealDateLabel } from './mealDates.js';
import { addNativeBackHandler } from '../../nativeNavigation.js';

export function MealShoppingDialog({ week, meals, onClose }: { week: string; meals: Meal[]; onClose: () => void }) {
  const { family, user, familyConfirmed } = useMe();
  const offline = useOffline();
  const client = useQueryClient();
  const [listId, setListId] = useState<string | null>(null);
  const [mealIds, setMealIds] = useState(meals.filter((meal) => meal.ingredients.length).map((meal) => meal.id));
  const [attempt, setAttempt] = useState<{ id: string; confirmRepeat: boolean } | null>(null);
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
  const [result, setResult] = useState<{ added: number; updated: number } | null>(null);
  const writable = !!user && user.role !== 'child' && familyConfirmed && !offline;
  const lists = useQuery({
    queryKey: ['meal-export-lists', family?.id, user?.id],
    enabled: writable,
    queryFn: async ({ signal }) =>
      shoppingListsResponseSchema.parse(await apiFetch('/api/shopping/lists', { signal })).lists,
  });
  const send = async () => {
    if (sending.current || !writable || isOffline() || !listId || !mealIds.length || (repeat && !confirmed)) return;
    const operation = attempt ?? { id: crypto.randomUUID(), confirmRepeat: false };
    // Freeze the request after its first send. An uncertain response must retry the same payload and ID.
    setAttempt(operation);
    sending.current = true;
    setPending(true);
    setError('');
    try {
      const response = mealsToShoppingListResponseSchema.parse(
        await apiFetch(`/api/meals/to-shopping-list?operationId=${operation.id}`, {
          method: 'POST',
          body: JSON.stringify({ weekStart: week, listId, mealIds, confirmRepeat: operation.confirmRepeat }),
        }),
      );
      setResult(response);
      void client.invalidateQueries({ queryKey: shoppingKey({ familyId: family!.id, userId: user!.id }) });
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.code === 'MEAL_EXPORT_CONFIRMATION_REQUIRED') {
        setRepeat(true);
        setAttempt({ ...operation, confirmRepeat: true });
      } else {
        setError(
          cause instanceof ApiRequestError
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
        {result ? (
          <>
            <Alert color="sage" role="status">
              Dodano pozycji: {result.added}. Uzupełniono pozycji: {result.updated}.
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
              <Alert color="yellow">Połącz się z internetem i potwierdź dostęp do rodziny, aby dodać składniki.</Alert>
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
            {repeat && (
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
                  (!attempt && (lists.isError || !lists.data?.some((list) => list.id === listId))) ||
                  (repeat && !confirmed)
                }
                onClick={() => void send()}
              >
                {repeat ? 'Dodaj ponownie' : error ? 'Ponów eksport' : 'Dodaj składniki'}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
