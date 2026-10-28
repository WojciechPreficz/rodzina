import { useRef, useState, type FormEvent } from 'react';
import { Alert, Autocomplete, Button, Group, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { mealSuggestionsResponseSchema, putMealSchema, type Meal, type PutMeal } from '@rodzina/shared';
import { apiFetch } from '../../api.js';
import { useFormNavigation } from '../../useFormNavigation.js';
import { allowNavigation } from '../../nativeNavigation.js';

export function MealForm({
  meal,
  account,
  disabled,
  pending,
  onSave,
  onCancel,
}: {
  meal?: Meal | undefined;
  account: string;
  disabled: boolean;
  pending: boolean;
  onSave: (data: PutMeal) => Promise<void>;
  onCancel: () => void;
}) {
  const navigation = useFormNavigation();
  const ingredientToFocus = useRef<string | null>(null);
  const [title, setTitle] = useState(meal?.title ?? '');
  const [notes, setNotes] = useState(meal?.notes ?? '');
  const [ingredients, setIngredients] = useState(
    (meal?.ingredients ?? []).map((item) => ({ ...item, key: crypto.randomUUID() })),
  );
  const [error, setError] = useState('');
  const [search] = useDebouncedValue(title.trim(), 250);
  const suggestions = useQuery({
    queryKey: ['meal-suggestions', account, search],
    enabled: !disabled,
    queryFn: async ({ signal }) =>
      mealSuggestionsResponseSchema.parse(
        await apiFetch(`/api/meals/suggestions?q=${encodeURIComponent(search)}`, { signal }),
      ).suggestions,
  });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || pending) return;
    const result = putMealSchema.safeParse({
      title,
      notes: notes.trim() || null,
      ingredients: ingredients.map(({ name, quantity }) => ({ name, quantity: quantity?.trim() || null })),
    });
    if (!result.success) {
      setError('Podaj nazwę dania i nazwy wszystkich składników. Sprawdź długość wpisanych danych.');
      return;
    }
    setError('');
    try {
      await onSave(result.data);
      navigation.saved();
      onCancel();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nie udało się zapisać obiadu.');
    }
  }
  return (
    <form data-navigation-guard="true" onChange={navigation.changed} onSubmit={(event) => void submit(event)}>
      <Stack>
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        {disabled && <Alert color="yellow">Połącz się z internetem, aby zapisać zmiany.</Alert>}
        <fieldset disabled={disabled || pending} className="meal-fieldset">
          <Stack>
            <Autocomplete
              openOnFocus
              comboboxProps={{ withinPortal: false }}
              label="Nazwa dania"
              required
              maxLength={200}
              value={title}
              data-autofocus
              data={(suggestions.data ?? []).map((item) => item.title)}
              onChange={(value) => {
                setTitle(value);
                navigation.changed();
              }}
              onOptionSubmit={(value) => {
                const chosen = suggestions.data?.find((item) => item.title === value);
                if (chosen) setIngredients(chosen.ingredients.map((item) => ({ ...item, key: crypto.randomUUID() })));
                navigation.changed();
              }}
              description="Wybierz wcześniejsze danie z podpowiedzi, aby uzupełnić składniki."
            />
            {suggestions.isError && (
              <Text size="sm" c="red" role="status">
                Nie udało się pobrać podpowiedzi. Możesz wpisać danie i składniki samodzielnie.
              </Text>
            )}
            <Textarea
              label="Notatka"
              maxLength={5000}
              minRows={3}
              value={notes}
              onChange={(event) => setNotes(event.currentTarget.value)}
            />
            <Text fw={600}>Składniki</Text>
            {ingredients.length === 0 && (
              <Text size="sm" c="dimmed">
                Możesz zapisać obiad bez składników.
              </Text>
            )}
            {ingredients.map((item, index) => (
              <div className="meal-ingredient" key={item.key}>
                <TextInput
                  ref={(input) => {
                    if (input && ingredientToFocus.current === item.key) {
                      ingredientToFocus.current = null;
                      input.focus();
                    }
                  }}
                  label={`Składnik ${index + 1}`}
                  required
                  maxLength={200}
                  value={item.name}
                  onChange={(event) => {
                    const name = event.currentTarget.value;
                    setIngredients((items) =>
                      items.map((entry) => (entry.key === item.key ? { ...entry, name } : entry)),
                    );
                  }}
                />
                <TextInput
                  label={`Ilość ${index + 1}`}
                  maxLength={200}
                  placeholder="np. 500 g"
                  value={item.quantity ?? ''}
                  onChange={(event) => {
                    const quantity = event.currentTarget.value;
                    setIngredients((items) =>
                      items.map((entry) => (entry.key === item.key ? { ...entry, quantity } : entry)),
                    );
                  }}
                />
                <Button
                  variant="subtle"
                  color="red"
                  aria-label={`Usuń składnik ${index + 1}`}
                  onClick={() => {
                    setIngredients((items) => items.filter((entry) => entry.key !== item.key));
                    navigation.changed();
                  }}
                >
                  Usuń
                </Button>
              </div>
            ))}
            <Button
              variant="light"
              disabled={ingredients.length >= 100}
              onClick={() => {
                const key = crypto.randomUUID();
                ingredientToFocus.current = key;
                setIngredients((items) => [...items, { key, name: '', quantity: null }]);
                navigation.changed();
              }}
            >
              Dodaj składnik
            </Button>
          </Stack>
        </fieldset>
        <Group justify="flex-end">
          <Button
            variant="default"
            disabled={pending}
            onClick={() => {
              if (allowNavigation()) onCancel();
            }}
          >
            Anuluj
          </Button>
          <Button type="submit" disabled={disabled} loading={pending}>
            Zapisz
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
