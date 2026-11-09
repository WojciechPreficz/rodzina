import { Alert, Button, Group, Modal, Stack, Text, type ButtonProps } from '@mantine/core';
import { useState } from 'react';
import { useMe } from '../sessionContext.js';
import { isOffline, useOffline } from '../connectivity.js';
import { labels } from '../i18n/pl.js';
import { requestValue, transact } from '../offline/database.js';
import { synchronizeAccountChanges } from '../accountAdapters.js';
import { getSessionGeneration } from '../platform.js';

export function LogoutControl({
  beforeLogout,
  onLogout,
  ...props
}: ButtonProps & { beforeLogout?: () => boolean; onLogout?: () => void }) {
  const { user, family, logout } = useMe();
  const account = user && family ? `${family.id}:${user.id}` : '';
  const offline = useOffline();
  const [count, setCount] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pending = () =>
    transact('readonly', (tx) => requestValue(tx.objectStore('outbox').index('accountId').count(account)));
  const close = () => {
    setCount(undefined);
    setError('');
  };
  const run = async (action: 'check' | 'send' | 'discard') => {
    const generation = getSessionGeneration();
    const current = () => generation === getSessionGeneration();
    setError('');
    setBusy(true);
    try {
      if (action === 'send') {
        if (isOffline()) return;
        await synchronizeAccountChanges(account);
        if (!current()) return;
      }
      if (action !== 'discard') {
        const remaining = await pending();
        if (!current()) return;
        if (remaining) {
          setCount(remaining);
          if (action === 'send')
            setError('Część zmian nadal czeka na wysłanie. Sprawdź połączenie i stan synchronizacji.');
          return;
        }
      }
      await logout(action === 'discard' ? undefined : 'queue-checked');
      onLogout?.();
    } catch {
      if (current()) setError('Nie udało się zakończyć wylogowania. Spróbuj ponownie.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        {...props}
        loading={busy}
        onClick={() => {
          if (!beforeLogout || beforeLogout()) void run('check');
        }}
      >
        {labels.logout}
      </Button>
      {count === undefined && error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
      <Modal
        opened={count !== undefined}
        onClose={close}
        title="Niewysłane zmiany"
        centered
        closeOnClickOutside={!busy}
        closeOnEscape={!busy}
        withCloseButton={!busy}
      >
        <Stack>
          <Text>Liczba niewysłanych zmian: {count}</Text>
          {error && (
            <Alert color="red" role="alert">
              {error}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" disabled={busy} onClick={close}>
              Anuluj
            </Button>
            {!offline && (
              <Button disabled={busy} onClick={() => void run('send')}>
                Wyślij i wyloguj
              </Button>
            )}
            <Button color="red" variant="light" disabled={busy} onClick={() => void run('discard')}>
              Wyloguj i odrzuć zmiany
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
