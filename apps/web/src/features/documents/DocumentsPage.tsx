import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Group, Loader, Modal, Paper, Stack, Text, Title } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getDocumentStatus, type CreateDocument, type FamilyDocument } from '@rodzina/shared';
import { apiFetch } from '../../api.js';
import { useMe } from '../../auth.js';
import { isOffline, useOffline } from '../../connectivity.js';
import { PageHeader } from '../../components/PageHeader.js';
import { allowNavigation } from '../../nativeNavigation.js';
import { useMembersQuery } from '../family/familyQueries.js';
import { refreshLocalSchedule } from '../notifications/scheduleSync.js';
import { SYNC_INTERVAL_MS } from '../../queryClient.js';
import { DocumentForm, DocumentWarning } from './DocumentForm.js';
import { documentExpiry, documentStatuses, documentTypeLabels, hasVehicle } from './documentUi.js';
import './documents.css';

export function DocumentsPage() {
  const { user, family, familyConfirmed } = useMe();
  const offline = useOffline();
  const client = useQueryClient();
  const members = useMembersQuery();
  const key = ['documents', family?.id, user?.id];
  const query = useQuery({
    queryKey: key,
    enabled: !!family && !!user && familyConfirmed && !offline,
    queryFn: async ({ signal }) =>
      (await apiFetch<{ documents: FamilyDocument[] }>('/api/documents', { signal })).documents,
    refetchInterval: SYNC_INTERVAL_MS,
  });
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<FamilyDocument | 'new' | null>(null);
  const [deleting, setDeleting] = useState<FamilyDocument | null>(null);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const timezone = family?.timezone ?? 'Europe/Warsaw';
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(clock);
  const documents = (query.data ?? [])
    .map((item) => ({ ...item, status: getDocumentStatus(item.type, item.expiresOn, today) }))
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
  const canEdit = user?.role !== 'child';
  const writable = canEdit && familyConfirmed && !offline;
  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: key }), refreshLocalSchedule(client)]);
  const save = useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async (data: CreateDocument) => {
      if (!writable || isOffline()) throw new Error('Połącz się z internetem, aby zapisać dokument.');
      const id = editing && editing !== 'new' ? editing.id : undefined;
      return apiFetch(`/api/documents${id ? `/${encodeURIComponent(id)}` : ''}`, {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(data),
      });
    },
    onSuccess: async () => {
      setEditing(null);
      await refresh();
    },
  });
  const remove = useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async () => {
      if (!writable || isOffline()) throw new Error('Połącz się z internetem, aby usunąć dokument.');
      await apiFetch(`/api/documents/${encodeURIComponent(deleting!.id)}`, { method: 'DELETE' });
    },
    onSuccess: async () => {
      setDeleting(null);
      await refresh();
    },
  });
  const filters = [
    { value: 'all', label: 'Wszyscy' },
    ...(members.data ?? []).map((member) => ({ value: member.id, label: member.displayName })),
    { value: 'vehicles', label: 'Pojazdy' },
  ];
  const selected = filters.find((item) => item.value === filter) ?? filters[0]!;
  const visible = documents.filter(
    (item) =>
      selected.value === 'all' ||
      (selected.value === 'vehicles' ? hasVehicle(item.type) : item.holderUserId === selected.value),
  );
  const add = () => {
    save.reset();
    setEditing('new');
  };
  const close = () => {
    if (!save.isPending && allowNavigation()) setEditing(null);
  };
  return (
    <Stack className="documents-page" gap="lg">
      <PageHeader
        title="Dokumenty"
        description="Daty ważności dokumentów rodziny"
        actions={
          canEdit && (
            <Button className="documents-add" disabled={!writable} onClick={add}>
              ＋ Dodaj dokument
            </Button>
          )
        }
      />
      {offline && <Alert color="yellow">Brak połączenia. Zarządzanie dokumentami wymaga internetu.</Alert>}
      {query.isError && (
        <Alert color="red" role="alert">
          {query.error.message}{' '}
          <Button variant="subtle" onClick={() => void query.refetch()}>
            Spróbuj ponownie
          </Button>
        </Alert>
      )}
      {query.isPending && !offline && <Loader aria-label="Ładowanie dokumentów" />}
      <div className="documents-layout">
        <Paper withBorder className="documents-filters">
          <div className="documents-filter-heading">
            <Text className="documents-eyebrow">Filtr dokumentów</Text>
            <Title order={2}>Filtruj</Title>
          </div>
          <nav className="documents-filter-options" aria-label="Filtr dokumentów">
            {filters.map((item) => (
              <Button
                key={item.value}
                variant={selected.value === item.value ? 'light' : 'subtle'}
                aria-pressed={selected.value === item.value}
                onClick={() => setFilter(item.value)}
              >
                {item.label}
              </Button>
            ))}
          </nav>
          <div className="documents-filter-summary">
            <Group justify="space-between">
              <Text size="sm">Wygasa</Text>
              <Badge color="orange" variant="light">
                {documents.filter((item) => item.status === 'expiring').length}
              </Badge>
            </Group>
            <Group justify="space-between">
              <Text size="sm">Wygasło</Text>
              <Badge color="red" variant="light">
                {documents.filter((item) => item.status === 'expired').length}
              </Badge>
            </Group>
            {canEdit && (
              <Button disabled={!writable} onClick={add}>
                ＋ Dodaj dokument
              </Button>
            )}
          </div>
        </Paper>
        <Paper withBorder className="documents-list" component="section" aria-label="Dokumenty rodziny">
          <Text className="documents-eyebrow">Dokumenty rodziny</Text>
          <Title order={2}>{selected.label}</Title>
          <DocumentWarning />
          {query.isSuccess && visible.length === 0 && (
            <Text c="dimmed" py="xl">
              {documents.length ? 'Brak dokumentów dla tego filtra.' : 'Nie dodano jeszcze dokumentów.'}
            </Text>
          )}
          <ul className="document-rows">
            {visible.map((item) => (
              <li key={item.id} className="document-row" data-status={item.status}>
                <span className="document-status-dot" aria-hidden="true" />
                <svg
                  className="document-icon"
                  width="22"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path d="M6 2h8l5 5v15H6ZM14 2v6h5M9 12h7M9 16h7" />
                </svg>
                <div className="document-description">
                  <Text fw={500}>{item.label}</Text>
                  <Text size="sm" className="document-expiry">
                    {documentExpiry(item.expiresOn, today)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {members.data?.find((member) => member.id === item.holderUserId)?.displayName ??
                      item.vehicleLabel ??
                      documentTypeLabels[item.type]}
                  </Text>
                  {item.notes && (
                    <Text size="sm" className="document-notes">
                      {item.notes}
                    </Text>
                  )}
                </div>
                <Badge
                  color={documentStatuses[item.status].color}
                  variant="light"
                  radius="sm"
                  tt="none"
                  className="document-status"
                >
                  {documentStatuses[item.status].label}
                </Badge>
                {canEdit && (
                  <div className="document-actions">
                    <Button
                      size="xs"
                      variant="subtle"
                      disabled={!writable}
                      aria-label={`Edytuj ${item.label}`}
                      onClick={() => {
                        save.reset();
                        setEditing(item);
                      }}
                    >
                      Edytuj
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      disabled={!writable}
                      aria-label={`Usuń ${item.label}`}
                      onClick={() => {
                        remove.reset();
                        setDeleting(item);
                      }}
                    >
                      Usuń
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Paper>
      </div>
      <Modal
        opened={editing !== null}
        onClose={close}
        title={editing === 'new' ? 'Dodaj dokument' : 'Edytuj dokument'}
        size="lg"
        closeOnClickOutside={false}
        closeOnEscape={!save.isPending}
        withCloseButton={!save.isPending}
      >
        {editing && (
          <DocumentForm
            document={editing === 'new' ? undefined : editing}
            members={members.data ?? []}
            timezone={timezone}
            pending={save.isPending}
            error={save.error?.message}
            onCancel={() => setEditing(null)}
            onSave={async (data) => {
              try {
                await save.mutateAsync(data);
              } catch {
                /* The mutation error remains in the form. */
              }
            }}
          />
        )}
      </Modal>
      <Modal
        opened={deleting !== null}
        onClose={() => {
          if (!remove.isPending) setDeleting(null);
        }}
        title="Usuń dokument"
        closeOnEscape={!remove.isPending}
        closeOnClickOutside={!remove.isPending}
        withCloseButton={!remove.isPending}
      >
        <Stack>
          <Text>Czy usunąć dokument „{deleting?.label}” i jego przypomnienia?</Text>
          {remove.error && (
            <Alert color="red" role="alert">
              {remove.error.message}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" disabled={remove.isPending} onClick={() => setDeleting(null)}>
              Anuluj
            </Button>
            <Button color="red" loading={remove.isPending} onClick={() => remove.mutate()}>
              Usuń dokument
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
