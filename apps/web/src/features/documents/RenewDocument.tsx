import { useState } from 'react';
import { Alert, Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { renewDocumentSchema, type FamilyDocument } from '@rodzina/shared';
import { apiFetch } from '../../api.js';
import { useMe } from '../../sessionContext.js';
import { isOffline, useOffline } from '../../connectivity.js';
import { allowNavigation } from '../../nativeNavigation.js';
import { useFormNavigation } from '../../useFormNavigation.js';
import { refreshLocalSchedule } from '../notifications/scheduleSync.js';

export function RenewDocument({ document, onClose }: { document: FamilyDocument; onClose: () => void }) {
  const { user, family, familyConfirmed } = useMe();
  const offline = useOffline();
  const client = useQueryClient();
  const navigation = useFormNavigation();
  const [expiresOn, setExpiry] = useState('');
  const [invalid, setInvalid] = useState(false);
  const writable = user?.role !== 'child' && familyConfirmed && !offline;
  const renew = useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async () => {
      if (!writable || isOffline()) throw new Error('Połącz się z internetem, aby odnowić dokument.');
      return apiFetch(`/api/documents/${encodeURIComponent(document.id)}/renew`, {
        method: 'POST',
        body: JSON.stringify(renewDocumentSchema.parse({ expiresOn })),
      });
    },
    onSuccess: async () => {
      onClose();
      await Promise.all([
        client.invalidateQueries({ queryKey: ['documents', family?.id, user?.id] }),
        client.invalidateQueries({ queryKey: ['document-reminders', family?.id, user?.id, document.id] }),
        refreshLocalSchedule(client),
      ]);
    },
  });
  const close = () => {
    if (!renew.isPending && allowNavigation()) onClose();
  };
  return (
    <Modal
      opened
      onClose={close}
      title="Odnowiono dokument"
      closeOnClickOutside={false}
      closeOnEscape={!renew.isPending}
      withCloseButton={!renew.isPending}
    >
      <form
        data-navigation-guard="true"
        onChange={navigation.changed}
        onSubmit={(event) => {
          event.preventDefault();
          const valid = renewDocumentSchema.safeParse({ expiresOn }).success;
          setInvalid(!valid);
          if (valid && !renew.isPending) renew.mutate();
        }}
      >
        <Stack>
          <Text>{document.label}</Text>
          <Text size="sm">
            Przypomnienia przed terminem zostaną przeliczone. Minione przypomnienia z konkretną datą pozostaną
            nieaktualne.
          </Text>
          <TextInput
            type="date"
            label="Nowa data ważności"
            required
            value={expiresOn}
            disabled={renew.isPending || !writable}
            error={invalid ? 'Podaj poprawną datę.' : undefined}
            onChange={(event) => setExpiry(event.currentTarget.value)}
            data-autofocus
          />
          {renew.error && (
            <Alert color="red" role="alert">
              {renew.error.message}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" disabled={renew.isPending} onClick={close}>
              Anuluj
            </Button>
            <Button type="submit" loading={renew.isPending} disabled={!writable}>
              Zapisz nową datę
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
