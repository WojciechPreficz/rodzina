import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Paper, Stack, TextInput } from '@mantine/core';
import { Link } from 'react-router';
import { forgotPasswordInputSchema, passwordRecoveryAvailabilitySchema } from '@rodzina/shared';
import { apiFetch, ApiRequestError } from '../api.js';
import { PageHeader } from './PageHeader.js';
import { labels } from '../i18n/pl.js';

function useRecoveryAvailability() {
  const [enabled, setEnabled] = useState<boolean>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch('/api/auth/password-recovery', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setEnabled(passwordRecoveryAvailabilitySchema.parse(result).enabled);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [attempt]);
  const retry = () => {
    setFailed(false);
    setEnabled(undefined);
    setAttempt((value) => value + 1);
  };
  return { enabled, failed, retry };
}

export function PasswordRecoveryLink() {
  const { enabled } = useRecoveryAvailability();
  return enabled ? (
    <Button component={Link} to="/nie-pamietam-hasla" variant="subtle">
      {labels.forgotPassword}
    </Button>
  ) : null;
}

export function ForgotPasswordPage() {
  const { enabled, failed, retry } = useRecoveryAvailability();
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || !enabled) return;
    const parsed = forgotPasswordInputSchema.safeParse({ email });
    setFieldError(parsed.success ? '' : labels.emailError);
    if (!parsed.success) return;
    if (!navigator.onLine) {
      setError(labels.recoveryOffline);
      return;
    }
    setPending(true);
    setError('');
    try {
      await apiFetch('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify(parsed.data) });
      setSuccess(true);
      setEmail('');
    } catch (requestError) {
      setError(requestError instanceof ApiRequestError ? requestError.message : labels.recoveryOffline);
    } finally {
      setPending(false);
    }
  };
  return (
    <Paper className="auth-card" withBorder p="lg">
      <Stack>
        <PageHeader title={labels.forgotPassword} />
        {success ? (
          <Alert color="green" role="status">
            {labels.recoverySent}
          </Alert>
        ) : (
          <form onSubmit={submit} noValidate>
            <Stack>
              <TextInput
                type="email"
                autoComplete="email"
                label={labels.email}
                required
                value={email}
                onChange={(event) => {
                  setEmail(event.currentTarget.value);
                  setFieldError('');
                }}
                error={fieldError}
              />
              <Button type="submit" loading={pending} disabled={!enabled || failed}>
                {labels.sendResetLink}
              </Button>
            </Stack>
          </form>
        )}
        {enabled === false && <Alert role="alert">{labels.recoveryUnavailable}</Alert>}
        {(error || failed) && (
          <Alert color="red" role="alert">
            {error || labels.recoveryOffline}
          </Alert>
        )}
        {failed && (
          <Button variant="subtle" onClick={retry}>
            {labels.recoveryRetry}
          </Button>
        )}
        <Button component={Link} to="/login" variant="subtle">
          {labels.login}
        </Button>
      </Stack>
    </Paper>
  );
}
