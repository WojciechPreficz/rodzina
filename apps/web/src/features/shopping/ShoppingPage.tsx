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
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { SHOPPING_CATEGORIES, createShoppingItemSchema, type ShoppingItem, type ShoppingList } from '@rodzina/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMediaQuery } from '@mantine/hooks';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useMe } from '../../auth.js';
import { PageHeader } from '../../components/PageHeader.js';
import { addNativeBackHandler } from '../../nativeNavigation.js';
import { labels } from '../../i18n/pl.js';
import { useMembersQuery } from '../family/familyQueries.js';
import { QuickAdd } from './QuickAdd.js';
import { useShopping } from './shoppingQueries.js';
import type { ShoppingChange } from './shoppingApi.js';
import './shopping.css';

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
  const [params, setParams] = useSearchParams();
  const selected = params.get('lista');
  const navigate = useNavigate();
  const location = useLocation();
  const wide = useMediaQuery('(min-width: 48em)');
  const catalog = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const returnTo = useRef<{ id: string; scroll: number } | null>(null);
  const previous = useRef(selected);
  const openList = (id: string) => {
    if (!wide) returnTo.current = { id, scroll: window.scrollY };
    setParams({ lista: id }, { state: { shoppingCatalog: !selected } });
  };
  const backToCatalog = () => {
    if (location.state?.shoppingCatalog) void navigate(-1);
    else setParams({}, { replace: true });
  };
  const { lists, items, queueChange, active, online, pendingCount, syncError, reviewCount, discardReview } =
    useShopping(selected);
  const members = useMembersQuery();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const adult = user?.role !== 'child';
  useEffect(() => {
    if (!selected || wide) return;
    return addNativeBackHandler(() => {
      if (location.state?.shoppingCatalog) void navigate(-1);
      else setParams({}, { replace: true });
    });
  }, [selected, wide, location.state, navigate, setParams]);
  useEffect(() => {
    if (previous.current === selected) return;
    previous.current = selected;
    if (wide) return;
    const frame = requestAnimationFrame(() => {
      if (selected) {
        window.scrollTo(0, 0);
        heading.current?.focus({ preventScroll: true });
      } else if (returnTo.current) {
        const target = [...(catalog.current?.querySelectorAll<HTMLButtonElement>('[data-list-id]') ?? [])].find(
          (button) => button.dataset.listId === returnTo.current?.id,
        );
        target?.focus({ preventScroll: true });
        window.scrollTo(0, returnTo.current.scroll);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [selected, wide]);
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
      <Paper
        key={item.id}
        className={`shopping-row${item.isChecked ? ' shopping-row-checked' : ''}`}
        component="article"
        aria-label={item.name}
      >
        <Group wrap="nowrap" align="center" gap="xs">
          <Checkbox
            checked={item.isChecked}
            className="shopping-checkbox"
            aria-label={t.check(item.name)}
            onChange={() =>
              void run({ type: 'edit', listId: item.listId, id: item.id, data: { isChecked: !item.isChecked } })
            }
            label={
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
            }
          />
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
    <Stack className={`shopping-page${selected ? ' shopping-page-detail' : ''}`} gap="lg">
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          adult && (
            <Button variant="filled" onClick={() => setDialog({ type: 'createList' })}>
              <span aria-hidden="true">＋&nbsp;</span>
              {t.addList}
            </Button>
          )
        }
      />
      {!online && (
        <Alert color="yellow" role="status">
          {t.offline}
        </Alert>
      )}
      {online && pendingCount > 0 && <Text role="status">{t.syncing(pendingCount)}</Text>}
      {syncError && syncError !== error && (
        <Alert color="red" role="alert">
          {syncError}
          {reviewCount > 0 && (
            <Button variant="subtle" onClick={() => setDiscardOpen(true)}>
              Odrzuć zmiany wymagające sprawdzenia
            </Button>
          )}
        </Alert>
      )}
      <Modal opened={discardOpen} onClose={() => setDiscardOpen(false)} title="Odrzucić zapisane zmiany?">
        <Text>
          Usuniemy zmiany wymagające sprawdzenia oraz późniejsze zmiany tych samych list. Dane serwera pozostaną bez
          zmian.
        </Text>
        <Group mt="md">
          <Button variant="default" onClick={() => setDiscardOpen(false)}>
            Anuluj
          </Button>
          <Button
            color="red"
            onClick={() => {
              void discardReview()
                .then(() => setDiscardOpen(false))
                .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : t.failed));
            }}
          >
            Odrzuć zmiany
          </Button>
        </Group>
      </Modal>
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
      <div className="shopping-layout">
        <Paper component="section" className="shopping-catalog" withBorder ref={catalog} aria-label={t.lists}>
          <Group justify="space-between" mb="md">
            <Title order={2} size="h4">
              {t.lists}
            </Title>
            <Text size="sm" c="dimmed">
              {lists.data.length}
            </Text>
          </Group>
          <Stack gap="xs">
            {lists.data.map((list) => (
              <button
                key={list.id}
                type="button"
                className="shopping-list-card"
                data-list-id={list.id}
                aria-current={active?.id === list.id ? 'true' : undefined}
                onClick={() => openList(list.id)}
              >
                <span className="shopping-list-icon" aria-hidden="true">
                  ☷
                </span>
                <span className="shopping-list-name">{list.name}</span>
                <span aria-hidden="true">›</span>
              </button>
            ))}
          </Stack>
          {lists.data.length === 0 && (
            <Text c="dimmed" size="sm">
              {t.noLists}
            </Text>
          )}
          <Text c="dimmed" size="xs" mt="lg">
            {t.sharedLists}
          </Text>
        </Paper>
        <Paper component="section" className="shopping-content" withBorder aria-label={active?.name ?? t.lists}>
          <Button variant="subtle" className="shopping-back" onClick={backToCatalog}>
            ← {t.backToLists}
          </Button>
          {active && (
            <>
              <Group justify="space-between" align="flex-start" mb="lg" gap="xs">
                <div className="shopping-content-heading">
                  <Title order={2} ref={heading} tabIndex={-1}>
                    {active.name}
                  </Title>
                  {items.data && (
                    <Text c="dimmed" size="sm">
                      {t.remaining(open.length)} · {t.checked}: {checked.length}
                    </Text>
                  )}
                </div>
                {adult && (
                  <Menu position="bottom-end">
                    <Menu.Target>
                      <Button variant="default" aria-label={t.listActions}>
                        •••
                      </Button>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item onClick={() => setDialog({ type: 'renameList', list: active })}>
                        {t.renameList}
                      </Menu.Item>
                      <Menu.Item color="red" onClick={() => setDialog({ type: 'deleteList', list: active })}>
                        {t.deleteList}
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                )}
              </Group>
              <QuickAdd
                key={active.id}
                pending={!items.data}
                onAdd={(data) => run({ type: 'add', listId: active.id, id: crypto.randomUUID(), data })}
              />
              {!online && !items.data ? (
                <Alert color="yellow" role="status">
                  {t.noOfflineItems}
                </Alert>
              ) : items.isPending ? (
                <Text role="status">{t.loading}</Text>
              ) : all.length === 0 && !items.isError ? (
                <Text c="dimmed">{t.empty}</Text>
              ) : null}
              {SHOPPING_CATEGORIES.map((category) => {
                const group = sort(open.filter((item) => item.category === category.value));
                return group.length ? (
                  <Stack key={category.value} gap={0} className="shopping-category">
                    <Title order={2} size="h4">
                      {category.label}{' '}
                      <Text component="span" size="sm" c="dimmed">
                        {group.length}
                      </Text>
                    </Title>
                    {group.map(row)}
                  </Stack>
                ) : null;
              })}
              {checked.length > 0 && (
                <Stack gap={0} className="shopping-category shopping-checked">
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
          {!active && <Text c="dimmed">{t.noLists}</Text>}
        </Paper>
      </div>
      {dialog && (
        <ShoppingDialog
          dialog={dialog}
          error={error}
          close={() => {
            setDialog(null);
            setError(null);
          }}
          save={async (change) => {
            if (await run(change)) {
              setDialog(null);
              if (change.type === 'deleteList') setParams({}, { replace: true });
            }
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
            <Button type="submit" color={editingList || dialog.type === 'edit' ? 'sage' : 'red'}>
              {editingList || dialog.type === 'edit' ? t.save : t.remove}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
