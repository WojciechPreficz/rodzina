import {
  Alert,
  Button,
  Checkbox,
  Group,
  Menu,
  Modal,
  Paper,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { SHOPPING_CATEGORIES, createShoppingItemSchema, type ShoppingItem, type ShoppingList } from '@rodzina/shared';
import { useState, type FormEvent } from 'react';
import { useMe } from '../../auth.js';
import { labels } from '../../i18n/pl.js';
import { useMembersQuery } from '../family/familyQueries.js';
import { QuickAdd } from './QuickAdd.js';
import { useShopping } from './shoppingQueries.js';
import type { ShoppingChange } from './shoppingApi.js';

const t = labels.shoppingUi;
type Dialog =
  | { type: 'createList' }
  | { type: 'renameList'; list: ShoppingList }
  | { type: 'deleteList'; list: ShoppingList }
  | { type: 'edit'; item: ShoppingItem }
  | { type: 'remove'; item: ShoppingItem }
  | { type: 'clear'; listId: string };

export function ShoppingPage() {
  const { user } = useMe();
  const [selected, setSelected] = useState<string | null>(null);
  const { lists, items, queueChange, active, online, pendingCount, syncError, dismissSyncError } =
    useShopping(selected);
  const members = useMembersQuery();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const adult = user?.role !== 'child';
  const run = async (change: ShoppingChange) => {
    setError(null);
    try {
      await queueChange(change);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.failed);
      return false;
    }
  };
  if (lists.isPending)
    return online ? (
      <Text role="status">{t.loading}</Text>
    ) : (
      <Alert color="yellow" role="status">
        {t.noOfflineCache}
      </Alert>
    );
  if (!lists.data)
    return (
      <Alert color="red">
        {t.error}
        <Button onClick={() => void lists.refetch()}>{t.retry}</Button>
      </Alert>
    );
  const all = items.data ?? [];
  const open = all.filter((item) => !item.isChecked);
  const checked = all.filter((item) => item.isChecked);
  const sort = (values: ShoppingItem[]) =>
    [...values].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const row = (item: ShoppingItem) => {
    const editable = adult || item.createdBy === user?.id;
    const buyer =
      item.checkedBy === user?.id
        ? user.displayName
        : members.data?.find((member) => member.id === item.checkedBy)?.displayName;
    return (
      <Paper key={item.id} p="sm" withBorder component="article" aria-label={item.name}>
        <Group wrap="nowrap" align="flex-start">
          <Checkbox
            checked={item.isChecked}

            mt={3}
            aria-label={t.check(item.name)}
            onChange={() =>
              void run({ type: 'edit', listId: item.listId, id: item.id, data: { isChecked: !item.isChecked } })
            }
          />
          <Stack gap={2} style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
            <Text td={item.isChecked ? 'line-through' : undefined} fw={500}>
              {item.name}
            </Text>
            {item.quantity && (
              <Text size="sm" c="dimmed">
                {item.quantity}
              </Text>
            )}
            {item.isChecked && (
              <Text size="xs" c="dimmed">
                {t.boughtBy(item.checkedBy === null ? t.formerMember : (buyer ?? '…'))}
              </Text>
            )}
          </Stack>
          {editable && (
            <Menu position="bottom-end">
              <Menu.Target>
                <Button variant="subtle" px="sm" aria-label={t.actions(item.name)}>
                  •••
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={() => setDialog({ type: 'edit', item })}>{t.edit}</Menu.Item>
                <Menu.Item color="red" onClick={() => setDialog({ type: 'remove', item })}>
                  {t.remove}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
        </Group>
      </Paper>
    );
  };
  return (
    <Stack maw={960} mx="auto" w="100%">
      <Group justify="space-between">
        <Title order={1}>{t.title}</Title>
        {adult && (
          <Button variant="light" onClick={() => setDialog({ type: 'createList' })}>
            {t.addList}
          </Button>
        )}
      </Group>
      {!online && (
        <Alert color="yellow" role="status">
          {t.offline}
        </Alert>
      )}
      {online && pendingCount > 0 && <Text role="status">{t.syncing(pendingCount)}</Text>}
      {syncError && syncError !== error && (
        <Alert color="red" role="alert" withCloseButton onClose={dismissSyncError}>
          {syncError}
        </Alert>
      )}
      {error && (
        <Alert color="red" role="alert" withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {(lists.isError || items.isError) && (
        <Alert color="red">
          {t.error}
          <Button
            variant="subtle"
            onClick={() => {
              void lists.refetch();
              void items.refetch();
            }}
          >
            {t.retry}
          </Button>
        </Alert>
      )}
      <Tabs value={active?.id ?? null} onChange={setSelected}>
        <Tabs.List aria-label={t.lists} style={{ flexWrap: 'nowrap', overflowX: 'auto' }}>
          {lists.data.map((list) => (
            <Tabs.Tab
              key={list.id}
              value={list.id}

              style={{ flexShrink: 0, maxWidth: 220, overflow: 'hidden', overflowWrap: 'anywhere' }}
            >
              {list.name}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
      {active && (
        <>
          {adult && (
            <Group gap="xs">
              <Button
                size="xs"
                variant="subtle"

                onClick={() => setDialog({ type: 'renameList', list: active })}
              >
                {t.renameList}
              </Button>
              <Button
                size="xs"
                variant="subtle"
                color="red"

                onClick={() => setDialog({ type: 'deleteList', list: active })}
              >
                {t.deleteList}
              </Button>
            </Group>
          )}
          <QuickAdd
            key={active.id}
            pending={items.isPending}
            onAdd={(data) => run({ type: 'add', listId: active.id, id: crypto.randomUUID(), data })}
          />
          {items.isPending ? (
            <Text role="status">{t.loading}</Text>
          ) : all.length === 0 && !items.isError ? (
            <Text c="dimmed">{t.empty}</Text>
          ) : null}
          {SHOPPING_CATEGORIES.map((category) => {
            const group = sort(open.filter((item) => item.category === category.value));
            return group.length ? (
              <Stack key={category.value} gap="xs">
                <Title order={2} size="h4">
                  {category.label}
                </Title>
                {group.map(row)}
              </Stack>
            ) : null;
          })}
          {checked.length > 0 && (
            <Stack gap="xs">
              <Group justify="space-between">
                <Title order={2} size="h4">
                  {t.checked} ({checked.length})
                </Title>
                {adult && (
                  <Button
                    size="xs"
                    variant="light"
                    color="red"

                    onClick={() => setDialog({ type: 'clear', listId: active.id })}
                  >
                    {t.clear}
                  </Button>
                )}
              </Group>
              {sort(checked).map(row)}
            </Stack>
          )}
        </>
      )}
      {dialog && (
        <ShoppingDialog
          dialog={dialog}
          error={error}
          close={() => {
            setDialog(null);
            setError(null);
          }}
          save={async (change) => {
            if (await run(change)) setDialog(null);
          }}
        />
      )}
    </Stack>
  );
}

function ShoppingDialog({
  dialog,
  error,
  close,
  save,
}: {
  dialog: Dialog;
  error: string | null;
  close: () => void;
  save: (change: ShoppingChange) => Promise<void>;
}) {
  const [name, setName] = useState('item' in dialog ? dialog.item.name : 'list' in dialog ? dialog.list.name : '');
  const [quantity, setQuantity] = useState(dialog.type === 'edit' ? (dialog.item.quantity ?? '') : '');
  const [category, setCategory] = useState<string>(dialog.type === 'edit' ? dialog.item.category : 'other');
  const [invalid, setInvalid] = useState(false);
  const editingList = dialog.type === 'createList' || dialog.type === 'renameList';
  const title =
    dialog.type === 'createList'
      ? t.addList
      : dialog.type === 'renameList'
        ? t.renameList
        : dialog.type === 'edit'
          ? t.editItem
          : dialog.type === 'clear'
            ? t.clear
            : dialog.type === 'deleteList'
              ? t.deleteList
              : t.remove;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    let change: ShoppingChange;
    if (editingList) {
      if (!name.trim() || name.trim().length > 200) {
        setInvalid(true);
        return;
      }
      change = {
        type: dialog.type,
        id: dialog.type === 'renameList' ? dialog.list.id : crypto.randomUUID(),
        name: name.trim(),
      };
    } else if (dialog.type === 'edit') {
      const result = createShoppingItemSchema.safeParse({ name, quantity, category });
      if (!result.success) {
        setInvalid(true);
        return;
      }
      change = { type: 'edit', listId: dialog.item.listId, id: dialog.item.id, data: result.data };
    } else if (dialog.type === 'clear') change = { type: 'clear', listId: dialog.listId };
    else if (dialog.type === 'deleteList') change = { type: 'deleteList', id: dialog.list.id };
    else change = { type: 'remove', listId: dialog.item.listId, id: dialog.item.id };
    void save(change);
  };
  return (
    <Modal opened onClose={close} title={title}>
      <form onSubmit={submit}>
        <Stack>
          {editingList || dialog.type === 'edit' ? (
            <TextInput
              label={editingList ? t.listName : t.name}
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              maxLength={200}
              required
            />
          ) : (
            <Text>
              {dialog.type === 'clear'
                ? t.clearConfirm
                : dialog.type === 'deleteList'
                  ? t.deleteListConfirm
                  : t.deleteItemConfirm}
            </Text>
          )}
          {dialog.type === 'edit' && (
            <>
              <TextInput
                label={t.quantity}
                value={quantity}
                onChange={(event) => setQuantity(event.currentTarget.value)}
                maxLength={100}
              />
              <Select
                label={t.category}
                data={[...SHOPPING_CATEGORIES]}
                value={category}
                onChange={(value) => setCategory(value ?? 'other')}
                allowDeselect={false}
              />
            </>
          )}
          {invalid && <Alert color="red">{editingList ? t.invalidList : t.invalid}</Alert>}
          {error && (
            <Alert color="red" role="alert">
              {error}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              {t.cancel}
            </Button>
            <Button type="submit" color={editingList || dialog.type === 'edit' ? 'blue' : 'red'}>
              {editingList || dialog.type === 'edit' ? t.save : t.remove}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
