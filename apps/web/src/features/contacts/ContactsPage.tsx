import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Group,
  Loader,
  Modal,
  MultiSelect,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type Contact, type ContactGroup, type CreateContact } from '@rodzina/shared';
import { apiFetch } from '../../api.js';
import { useMe } from '../../sessionContext.js';
import { isOffline, useOffline } from '../../connectivity.js';
import { allowNavigation } from '../../nativeNavigation.js';
import { PageHeader } from '../../components/PageHeader.js';
import { SYNC_INTERVAL_MS } from '../../queryClient.js';
import { ContactForm } from './ContactForm.js';
import { contactInitials, contactPhoneHref, matchesContact, sortContacts } from './contactUi.js';
import './contacts.css';
import { CONTACTS_SIGNAL, contactsStore } from './contactsOffline.js';
import { OfflineNotice } from '../../offline/OfflineNotice.js';

type Editor = { kind: 'contact'; contact?: Contact } | { kind: 'group'; group?: ContactGroup };
type Removal = { kind: 'contact'; item: Contact } | { kind: 'group'; item: ContactGroup };

export function ContactsPage() {
  const { user, family, familyConfirmed } = useMe();
  const offline = useOffline();
  const client = useQueryClient();
  const account = user && family ? `${family.id}:${user.id}` : '';
  const state = useSyncExternalStore(contactsStore.subscribe, contactsStore.snapshot);
  useEffect(() => {
    if (account) void contactsStore.activate(account);
    const reload = (event: StorageEvent) => {
      if (event.key === CONTACTS_SIGNAL || event.key === null) void contactsStore.reload();
    };
    window.addEventListener('storage', reload);
    return () => window.removeEventListener('storage', reload);
  }, [account]);
  const saved = state.account === account ? state.saved : undefined;
  const key = ['contacts', family?.id, user?.id];
  const query = useQuery({
    queryKey: key,
    staleTime: 0,
    enabled: !!user && !!family && familyConfirmed && !offline,
    queryFn: ({ signal }) => contactsStore.fetch(account, () => apiFetch('/api/contacts', { signal })),
    refetchInterval: SYNC_INTERVAL_MS,
  });
  const mobile = useMediaQuery('(max-width: 47.99em)');
  const [mobileFilters, setMobileFilters] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  useEffect(() => {
    setEditor(null);
    setDetails(null);
    setRemoval(null);
    setSelectedId(undefined);
    setMobileFilters([]);
    setSearch('');
  }, [account]);
  const groups = saved?.data.groups ?? [];
  const contacts = saved?.data.contacts ?? [];
  const selected = groups.find((group) => group.id === selectedId) ?? groups[0];
  const filteredGroups = mobile
    ? groups.filter((group) => mobileFilters.includes(group.id))
    : selected
      ? [selected]
      : [];
  const singleGroup = filteredGroups.length === 1 ? filteredGroups[0] : undefined;
  const formGroup = singleGroup ?? groups.find((group) => group.isDefault) ?? selected;
  const groupContacts = contacts.filter(
    (contact) => (mobile && !filteredGroups.length) || filteredGroups.some((group) => contact.groupId === group.id),
  );
  const visible = sortContacts(groupContacts.filter((contact) => matchesContact(contact, search)));
  const currentContact = contacts.find((contact) => contact.id === details);
  const canEdit = !!user && user.role !== 'child';
  const writable = canEdit && familyConfirmed && !offline;
  const mutation = useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async ({ path, method, data }: { path: string; method: string; data?: unknown }) => {
      if (!writable || isOffline()) throw new Error('Połącz się z internetem, aby zapisać zmiany.');
      return apiFetch(path, { method, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: key });
    },
  });
  const openEditor = (value: Editor) => {
    if (!allowNavigation()) return;
    mutation.reset();
    setEditor(value);
  };
  const closeDialog = () => {
    if (mutation.isPending) return;
    if (editor) {
      if (allowNavigation()) setEditor(null);
    } else if (removal) setRemoval(null);
    else setDetails(null);
  };
  const editSave = async (data: CreateContact) => {
    if (!editor) return;
    const id = editor.kind === 'contact' ? editor.contact?.id : editor.group?.id;
    await mutation.mutateAsync({
      path: `/api/${editor.kind === 'contact' ? 'contacts' : 'contact-groups'}${id ? `/${encodeURIComponent(id)}` : ''}`,
      method: id ? 'PATCH' : 'POST',
      data,
    });
  };
  const counts = new Map(
    groups.map((group) => [group.id, contacts.filter((contact) => contact.groupId === group.id).length]),
  );
  return (
    <Stack className="contacts-page">
      <PageHeader
        title="Kontakty"
        description="Twoje bliskie osoby, zawsze pod ręką."
        actions={
          canEdit && (
            <Button disabled={!writable || !selected} onClick={() => openEditor({ kind: 'group' })}>
              ＋ Dodaj grupę
            </Button>
          )
        }
      />
      <OfflineNotice
        offline={offline}
        syncedAt={saved?.syncedAt}
        issue={state.account === account ? state.issue : undefined}
        role="alert"
      >
        Brak połączenia z internetem. Dodawanie, edycja i usuwanie są niedostępne. Kontakty mogą być nieaktualne.
      </OfflineNotice>
      {query.isPending && !saved && !offline && (
        <Group role="status">
          <Loader size="sm" />
          <Text>Ładowanie kontaktów…</Text>
        </Group>
      )}
      {query.isError && (
        <Alert color="red" title="Nie udało się pobrać kontaktów" role="alert">
          <Text>Spróbuj ponownie po sprawdzeniu połączenia.</Text>
          {saved && (
            <Text>
              Kontakty mogą być nieaktualne. Ostatnie pobranie: {new Date(saved.syncedAt).toLocaleString('pl-PL')}.
            </Text>
          )}
          <Button variant="subtle" onClick={() => void query.refetch()}>
            Spróbuj ponownie
          </Button>
        </Alert>
      )}
      {offline && !saved && <Text>Brak zapisanych kontaktów. Połącz się z internetem, aby pobrać kontakty.</Text>}
      {saved && selected && (
        <div className="contacts-layout">
          <div className="contacts-groups">
            <Text className="contacts-eyebrow" size="xs" c="dimmed">
              Grupy kontaktów
            </Text>
            {mobile ? (
              <MultiSelect
                className="contacts-mobile-filter"
                label="Filtr kontaktów"
                placeholder={filteredGroups.length ? undefined : 'Wszystkie kontakty'}
                description="Wybierz grupy kontaktów. Brak wyboru pokazuje wszystkie kontakty."
                searchable
                clearable
                clearButtonProps={{ 'aria-label': 'Wyczyść filtry', 'aria-hidden': false, tabIndex: 0 }}
                nothingFoundMessage="Brak pasujących grup"
                data={groups.map((group) => ({ value: group.id, label: `${group.name} (${counts.get(group.id)})` }))}
                value={filteredGroups.map((group) => group.id)}
                onChange={setMobileFilters}
              />
            ) : (
              <nav aria-label="Grupy kontaktów" className="contacts-group-list">
                {groups.map((group) => (
                  <button
                    type="button"
                    className="contact-group"
                    key={group.id}
                    aria-pressed={selected.id === group.id}
                    onClick={() => {
                      if (selected.id === group.id || !allowNavigation()) return;
                      setSelectedId(group.id);
                      setSearch('');
                    }}
                  >
                    <span className="contact-group-icon" aria-hidden="true">
                      {contactInitials(group.name)}
                    </span>
                    <span className="contact-group-name">{group.name}</span>
                    <span className="contact-group-count" aria-label={`${counts.get(group.id)} kontaktów`}>
                      {counts.get(group.id)}
                    </span>
                  </button>
                ))}
              </nav>
            )}
          </div>
          <Paper withBorder radius="lg" className="contacts-card">
            <Text size="xs" c="dimmed" className="contacts-eyebrow">
              {singleGroup ? 'Wybrana grupa' : 'Grupy kontaktów'}
            </Text>
            <Group justify="space-between" align="center" mb="md">
              <Title order={2} className="contact-group-title">
                {singleGroup?.name ?? (filteredGroups.length ? 'Wybrane grupy' : 'Wszystkie kontakty')}
              </Title>
              <Text size="sm" c="dimmed">
                Kontakty: {groupContacts.length}
              </Text>
            </Group>
            {canEdit && singleGroup && (
              <Group gap="xs" mb="md">
                <Button
                  size="compact-sm"
                  variant="subtle"
                  disabled={!writable}
                  onClick={() => openEditor({ kind: 'group', group: singleGroup })}
                >
                  Zmień nazwę grupy
                </Button>
                {!singleGroup.isDefault && (
                  <Button
                    size="compact-sm"
                    variant="subtle"
                    color="red"
                    disabled={!writable}
                    onClick={() => {
                      mutation.reset();
                      setRemoval({ kind: 'group', item: singleGroup });
                    }}
                  >
                    Usuń grupę
                  </Button>
                )}
              </Group>
            )}
            {canEdit && (
              <Button fullWidth mb="md" disabled={!writable} onClick={() => openEditor({ kind: 'contact' })}>
                ＋ Dodaj kontakt
              </Button>
            )}
            <TextInput
              aria-label="Szukaj kontaktu"
              placeholder="Szukaj kontaktu…"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
              mb="md"
            />
            {visible.length === 0 && (
              <Text c="dimmed" py="xl" ta="center">
                {groupContacts.length
                  ? 'Brak wyników wyszukiwania.'
                  : singleGroup
                    ? 'W tej grupie nie ma jeszcze kontaktów.'
                    : 'Nie dodano jeszcze kontaktów.'}
              </Text>
            )}
            <div className="contact-list">
              {visible.map((contact, index) => (
                <article key={contact.id} className="contact-row">
                  <Avatar radius="xl" color={index % 3 === 0 ? 'orange' : 'sage'} aria-hidden="true">
                    {contactInitials(contact.name)}
                  </Avatar>
                  <div className="contact-row-content">
                    <button
                      type="button"
                      className="contact-open"
                      aria-label={`Szczegóły kontaktu: ${contact.name}`}
                      onClick={() => setDetails(contact.id)}
                    >
                      <span>{contact.name}</span>
                      <span aria-hidden="true">›</span>
                    </button>
                    {contact.relationship && (
                      <Text size="sm" c="dimmed">
                        {contact.relationship}
                      </Text>
                    )}
                    {contact.phone && (
                      <a className="contact-phone" href={contactPhoneHref(contact.phone)}>
                        {contact.phone}
                      </a>
                    )}
                    {contact.address && (
                      <Text size="xs" c="dimmed" className="contact-address">
                        {contact.address}
                      </Text>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </Paper>
        </div>
      )}
      <Modal
        opened={!!editor || !!removal || !!currentContact}
        onClose={closeDialog}
        title={
          removal
            ? removal.kind === 'group'
              ? 'Usuń grupę'
              : 'Usuń kontakt'
            : !editor
              ? 'Szczegóły kontaktu'
              : editor.kind === 'group'
                ? editor.group
                  ? 'Zmień nazwę grupy'
                  : 'Dodaj grupę'
                : editor?.contact
                  ? 'Edytuj kontakt'
                  : 'Dodaj kontakt'
        }
        closeOnClickOutside={!mutation.isPending}
        closeOnEscape={!mutation.isPending}
        closeButtonProps={{ disabled: mutation.isPending, 'aria-label': 'Zamknij formularz' }}
      >
        {editor && formGroup && (
          <ContactForm
            contact={editor.kind === 'contact' ? editor.contact : undefined}
            groups={groups}
            groupId={formGroup.id}
            groupOnly={editor.kind === 'group'}
            initialName={editor.kind === 'group' ? (editor.group?.name ?? '') : ''}
            disabled={!writable}
            pending={mutation.isPending}
            onSave={editSave}
            onCancel={() => setEditor(null)}
          />
        )}
        {!editor && !removal && currentContact && (
          <Stack>
            <Title order={3}>{currentContact.name}</Title>
            <Text c="dimmed">{groups.find((group) => group.id === currentContact.groupId)?.name}</Text>
            {currentContact.relationship && <Text>{currentContact.relationship}</Text>}
            {currentContact.phone && <a href={contactPhoneHref(currentContact.phone)}>{currentContact.phone}</a>}
            {currentContact.address && <Text className="contact-address">{currentContact.address}</Text>}
            {canEdit && (
              <Group>
                <Button disabled={!writable} onClick={() => openEditor({ kind: 'contact', contact: currentContact })}>
                  Edytuj
                </Button>
                <Button
                  variant="subtle"
                  color="red"
                  disabled={!writable}
                  onClick={() => {
                    mutation.reset();
                    setRemoval({ kind: 'contact', item: currentContact });
                  }}
                >
                  Usuń kontakt
                </Button>
              </Group>
            )}
          </Stack>
        )}
        {removal && (
          <Stack>
            <Text>Czy usunąć „{removal.item.name}”?</Text>
            {removal.kind === 'group' && (
              <Text>
                Kontakty zostaną przeniesione do grupy „{groups.find((group) => group.isDefault)?.name}”. Żaden kontakt
                nie zostanie usunięty.
              </Text>
            )}
            {mutation.isError && (
              <Alert color="red" role="alert">
                {mutation.error.message}
              </Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" disabled={mutation.isPending} onClick={() => setRemoval(null)}>
                Anuluj
              </Button>
              <Button
                color="red"
                disabled={!writable}
                loading={mutation.isPending}
                onClick={() => {
                  void mutation
                    .mutateAsync({
                      path: `/api/${removal.kind === 'group' ? 'contact-groups' : 'contacts'}/${encodeURIComponent(removal.item.id)}`,
                      method: 'DELETE',
                    })
                    .then(() => {
                      setRemoval(null);
                      if (removal.kind === 'contact') setDetails(null);
                    })
                    .catch(() => undefined);
                }}
              >
                Usuń
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
