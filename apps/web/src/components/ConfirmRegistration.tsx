import { Alert, Button, Paper, Stack, Text } from '@mantine/core';
import { confirmRegistrationInputSchema } from '@rodzina/shared';
import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { apiFetch } from '../api.js';
import { PageHeader } from './PageHeader.js';

export function ConfirmRegistrationPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const token = new URLSearchParams(location.hash.slice(1)).get('token');
  const valid = confirmRegistrationInputSchema.safeParse({ token }).success;
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const done = confirmed && !location.hash;
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (submitting.current || !valid) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      await apiFetch('/api/auth/confirm-registration', { method: 'POST', body: JSON.stringify({ token }) });
      setConfirmed(true);
      void navigate(location.pathname, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nie udało się potwierdzić rejestracji. Spróbuj ponownie.');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  return (
    <Paper className="auth-card" withBorder p="lg">
      <Stack gap="lg">
        <PageHeader title="Potwierdź założenie rodziny" />
        {done ? (
          <Alert color="green" role="status">
            Rodzina i konto administratora zostały utworzone. Zaloguj się podanym przy rejestracji adresem e-mail i
            hasłem. Jeśli rejestrujesz się w aplikacji na telefonie, wróć do niej i zaloguj się.
          </Alert>
        ) : !valid ? (
          <Alert color="red" role="alert">
            Link potwierdzenia jest nieprawidłowy. Otwórz pełny link z wiadomości lub ponów rejestrację.
          </Alert>
        ) : (
          <>
            <Text>
              Potwierdź chęć założenia konta rodziny. Dopiero teraz utworzymy rodzinę i konto administratora. Jeśli nie
              prosisz o założenie konta, zamknij tę stronę.
            </Text>
            {error && (
              <Alert color="red" role="alert">
                {error}
              </Alert>
            )}
            <Button loading={pending} onClick={() => void confirm()}>
              Potwierdź i utwórz rodzinę
            </Button>
          </>
        )}
        <Button component={Link} to="/login" variant={done ? 'filled' : 'default'}>
          Zaloguj się
        </Button>
        {!done && (
          <Button component={Link} to="/register" variant="subtle">
            Ponów rejestrację
          </Button>
        )}
      </Stack>
    </Paper>
  );
}
