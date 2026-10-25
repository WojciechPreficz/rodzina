import { useState } from 'react';
import { Alert, Badge, Button, Group, Loader, Paper, Stack, Text, Title } from '@mantine/core';
import { Link, useParams } from 'react-router';
import { getDocumentStatus } from '@rodzina/shared';
import { useMe } from '../../auth.js';
import { useOffline } from '../../connectivity.js';
import { PageHeader } from '../../components/PageHeader.js';
import { ReminderList } from '../../components/ReminderPicker.js';
import { reminderInput } from '../../components/reminderFields.js';
import { useMembersQuery } from '../family/familyQueries.js';
import { useDocumentDates, useDocumentsQuery } from './documentQueries.js';
import { documentExpiry, documentStatuses, documentTypeLabels } from './documentUi.js';
import { DocumentReminders } from './DocumentReminders.js';
import { RenewDocument } from './RenewDocument.js';
import './documents.css';

export function DocumentDetailsPage() {
  const { documentId } = useParams();
  const query = useDocumentsQuery();
  const { user, familyConfirmed } = useMe();
  const offline = useOffline();
  const { today, timezone } = useDocumentDates();
  const members = useMembersQuery();
  const [renewing, setRenewing] = useState(false);
  const document = query.data?.find((item) => item.id === documentId);
  const status = document ? documentStatuses[getDocumentStatus(document.type, document.expiresOn, today)] : null;
  return (
    <Stack className="documents-page" gap="lg">
      <PageHeader
        title="Szczegóły dokumentu"
        actions={
          <Button component={Link} to="/dokumenty" variant="default">
            Wszystkie dokumenty
          </Button>
        }
      />
      {offline && (
        <Alert color="yellow">Brak połączenia. Aktualne dane dokumentu i zarządzanie wymagają internetu.</Alert>
      )}
      {query.isPending && !offline && <Loader aria-label="Ładowanie dokumentu" />}
      {query.error && (
        <Alert color="red" role="alert">
          {query.error.message}{' '}
          <Button variant="subtle" onClick={() => void query.refetch()}>
            Spróbuj ponownie
          </Button>
        </Alert>
      )}
      {query.isSuccess && !document && (
        <Alert color="yellow">Nie znaleziono dokumentu. Mógł zostać usunięty lub należeć do innej rodziny.</Alert>
      )}
      {document && (
        <Paper withBorder className="documents-list">
          <Stack>
            <Group justify="space-between" wrap="wrap">
              <Title order={2} style={{ overflowWrap: 'anywhere', minWidth: 0 }}>
                {document.label}
              </Title>
              <Badge color={status!.color}>{status!.label}</Badge>
            </Group>
            <Text>{documentTypeLabels[document.type]}</Text>
            <Text>{documentExpiry(document.expiresOn, today)}</Text>
            {document.holderUserId && (
              <Text>
                Posiadacz: {members.data?.find((item) => item.id === document.holderUserId)?.displayName ?? 'Domownik'}
              </Text>
            )}
            {document.vehicleLabel && <Text>Pojazd: {document.vehicleLabel}</Text>}
            {document.notes && <Text className="document-notes">{document.notes}</Text>}
            {user?.role !== 'child' && (
              <Button
                style={{ alignSelf: 'start' }}
                disabled={offline || !familyConfirmed}
                onClick={() => setRenewing(true)}
              >
                Odnowiono
              </Button>
            )}
            <Title order={2}>Przypomnienia dokumentu</Title>
            <ReminderList
              document
              timezone={timezone}
              value={document.reminders.map((item) => ({ ...reminderInput(item), nextFireAt: item.nextFireAt }))}
            />
            <DocumentReminders key={document.id} documentId={document.id} timezone={timezone} />
          </Stack>
        </Paper>
      )}
      {document && renewing && (
        <RenewDocument key={document.id} document={document} onClose={() => setRenewing(false)} />
      )}
    </Stack>
  );
}
