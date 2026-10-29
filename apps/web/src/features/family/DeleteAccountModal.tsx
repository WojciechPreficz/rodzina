import { Alert, Button, Group, Modal, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiRequestError } from '../../api.js';
import { isOffline } from '../../connectivity.js';
import { useMe } from '../../sessionContext.js';
import type { Member } from '@rodzina/shared';
import { deleteFamily, deleteMember, listMembers } from './familyApi.js';
import { errorMessage } from './familyRules.js';
import { onlineActionHint, useFamilyReadOnly } from './familyQueries.js';

export function DeleteAccountModal({ target, onClose }: { target: Member | 'family'; onClose: () => void }) {
  const { user, family, logout, refresh } = useMe();
  const client = useQueryClient();
  const readOnly = useFamilyReadOnly();
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  if (!user || !family) return null;
  const wholeFamily = target === 'family';
  const own = wholeFamily || target.id === user.id;
  const title = wholeFamily ? 'Usuń całą rodzinę' : own ? 'Usuń moje konto' : `Usuń konto: ${target.displayName}`;

  const finish = async () => {
    if (own) await logout();
    else {
      await refresh();
      await client.invalidateQueries();
    }
    if (active.current) onClose();
  };

  const checkResult = async () => {
    if (readOnly || isOffline()) return;
    setPending(true);
    setError('');
    try {
      await apiFetch('/api/auth/me');
      if (!active.current) return;
      if (!wholeFamily && !own && !(await listMembers()).some((member) => member.id === target.id)) {
        if (active.current) await finish();
        return;
      }
      if (!active.current) return;
      setUncertain(false);
      setError('Konto nadal istnieje. Możesz ponownie potwierdzić usunięcie hasłem.');
    } catch (cause) {
      // A 401 uses the existing session-loss cleanup, including native alarms.
      if (active.current && !(cause instanceof ApiRequestError && cause.status === 401))
        setError('Nie można sprawdzić wyniku. Przywróć połączenie i sprawdź ponownie.');
    } finally {
      if (active.current) setPending(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (readOnly || isOffline() || pending || uncertain || completed) return;
    setPending(true);
    setError('');
    try {
      if (wholeFamily) await deleteFamily({ password, confirmationName: name });
      else await deleteMember(target.id, { password });
    } catch (cause) {
      if (!active.current) return;
      const unknown = !(cause instanceof ApiRequestError) || cause.status >= 500;
      setUncertain(unknown);
      setError(
        unknown
          ? 'Nie udało się potwierdzić wyniku usuwania. Sprawdź wynik przed ponowieniem.'
          : errorMessage(cause, 'Nie udało się usunąć konta.'),
      );
      setPassword('');
      setPending(false);
      return;
    }
    setPassword('');
    setCompleted(true);
    try {
      if (active.current) await finish();
    } catch (cause) {
      if (active.current)
        setError(`Konto zostało usunięte. ${errorMessage(cause, 'Nie udało się odświeżyć danych urządzenia.')}`);
    } finally {
      if (active.current) setPending(false);
    }
  };

  return (
    <Modal
      opened
      onClose={() => {
        if (!pending) onClose();
      }}
      title={title}
      centered
      closeOnClickOutside={!pending}
      closeOnEscape={!pending}
      withCloseButton={!pending}
      closeButtonProps={{ 'aria-label': 'Zamknij' }}
    >
      <form onSubmit={submit}>
        <Stack>
          <Text>
            {wholeFamily
              ? 'Trwale usuniesz całą rodzinę, wszystkich domowników i wszystkie dane rodziny w aplikacji. Tej operacji nie można cofnąć.'
              : 'Trwale usuniesz konto, jego sesje i prywatne listy zadań. Wspólne dane pozostaną, a udostępnione listy zadań przejdą na pozostałych członków.'}
          </Text>
          {own && (
            <Alert color="yellow">
              Zostaniesz wylogowany. Lokalne niewysłane zmiany zostaną usunięte.
              {!wholeFamily && ' Usunięcie samego konta nie usuwa kont dzieci.'}
            </Alert>
          )}
          <Text size="sm" c="dimmed">
            Inne urządzenia usuniętych osób utracą dostęp przy kontakcie z serwerem. Urządzenie offline może do tego
            czasu zachować dane i alarmy.
            {wholeFamily && ' Kopie zapasowe podlegają dotychczasowej retencji 14 kopii dziennych.'}
          </Text>
          {readOnly && <Text>{onlineActionHint}</Text>}
          {wholeFamily && (
            <TextInput
              label="Wpisz nazwę rodziny"
              description={family.name}
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              disabled={pending || readOnly || uncertain}
              required
              autoComplete="off"
            />
          )}
          <PasswordInput
            label="Twoje hasło"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            disabled={pending || readOnly || uncertain || completed}
            required
          />
          {error && (
            <Alert color="red" role="alert">
              {error}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" disabled={pending} onClick={onClose}>
              {completed ? 'Zamknij' : 'Anuluj'}
            </Button>
            {!completed &&
              (uncertain ? (
                <Button onClick={() => void checkResult()} loading={pending} disabled={readOnly}>
                  Sprawdź wynik
                </Button>
              ) : (
                <Button
                  type="submit"
                  color="red"
                  loading={pending}
                  disabled={readOnly || !password || (wholeFamily && name.trim() !== family.name.trim())}
                >
                  Usuń trwale
                </Button>
              ))}
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
