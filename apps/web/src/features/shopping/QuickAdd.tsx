import { Autocomplete, Button, Group, Stack, Text } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { createShoppingItemSchema, parseShoppingInput, type CreateShoppingItem } from '@rodzina/shared';
import { useState, type FormEvent } from 'react';
import { useMe } from '../../auth.js';
import { labels } from '../../i18n/pl.js';
import { shoppingSuggestions } from './shoppingApi.js';

const t = labels.shoppingUi;

export function QuickAdd({
  onAdd,
  pending,
}: {
  onAdd: (data: CreateShoppingItem) => Promise<boolean>;
  pending: boolean;
}) {
  const { user, family } = useMe();
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const [name] = useDebouncedValue(parseShoppingInput(value).name, 200);
  const suggestions = useQuery({
    queryKey: ['shoppingSuggestions', family?.id, user?.id, name],
    queryFn: ({ signal }) => shoppingSuggestions(name, signal),
    enabled: name.length > 0 && name.length <= 200,
  });
  const parsed = parseShoppingInput(value);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const suggestion = suggestions.data?.find(
      (item) => item.name.toLocaleLowerCase('pl') === parsed.name.toLocaleLowerCase('pl'),
    );
    const result = createShoppingItemSchema.safeParse({
      ...parsed,
      ...(suggestion ? { category: suggestion.category } : {}),
    });
    setError(!result.success);
    if (result.success && (await onAdd(result.data))) setValue('');
  };
  return (
    <form onSubmit={(event) => void submit(event)}>
      <Stack gap="xs">
        <Group align="flex-end" wrap="nowrap">
          <Autocomplete
            label={t.quickAdd}
            placeholder={t.hint}
            value={value}
            disabled={pending}
            maxLength={305}
            style={{ flex: 1, minWidth: 0 }}
            error={error ? t.invalid : undefined}
            onChange={(next) => {
              setValue(next);
              setError(false);
            }}
            data={(suggestions.data ?? []).map((item) => `${item.name}${parsed.quantity ? ` ${parsed.quantity}` : ''}`)}
            filter={({ options }) => options}
          />
          <Button type="submit" loading={pending} disabled={!value.trim()}>
            {t.add}
          </Button>
        </Group>
        <Text size="xs" c="dimmed">
          {t.hint}
        </Text>
      </Stack>
    </form>
  );
}
