import { PageHeader } from './PageHeader.js';
import type { SessionResponse } from '@rodzina/shared';
import { Alert, Anchor, Button, Checkbox, Group, Paper, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { useNavigate, useSearchParams } from 'react-router';
import { useId, useState } from 'react';
import { apiFetch, sanitizeNextPath } from '../api.js';
import { useMe } from '../sessionContext.js';
import { isAndroid } from '../platform.js';

import { labels } from '../i18n/pl.js';
import { PasswordRecoveryLink } from './PasswordRecovery.js';

export function RegisterPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ familyName: '', displayName: '', email: '', password: '' });
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const next = sanitizeNextPath(searchParams.get('next'));
  const termsErrorId = useId();
  const native = isAndroid();
  const termsPath = '/strona/regulamin.html';

  const onChange = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: '' }));
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const nextErrors: Record<string, string> = {
      familyName: form.familyName.trim().length >= 2 ? '' : labels.familyNameError,
      displayName: form.displayName.trim().length >= 2 ? '' : labels.displayNameError,
      email: form.email.trim() && /.+@.+\..+/.test(form.email) ? '' : labels.emailError,
      password: form.password.length >= 8 ? '' : labels.passwordError,
      acceptedTerms: acceptedTerms ? '' : labels.registrationTermsError,
    };

    setFieldErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    setPending(true);
    setError(null);
    try {
      await apiFetch('/api/auth/registration-requests', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          familyName: form.familyName.trim(),
          displayName: form.displayName.trim(),
          email: form.email.trim(),
          acceptedTerms,
        }),
      });
      setForm((current) => ({ ...current, password: '' }));
      setSent(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : labels.registrationError);
    } finally {
      setPending(false);
    }
  };

  return (
    <Paper className="auth-card" withBorder p="lg">
      <Stack gap="lg">
        <PageHeader title={labels.registerFamily} />
        {sent ? (
          <>
            <Alert color="green" role="status" title="Sprawdź pocztę" style={{ overflowWrap: 'anywhere' }}>
              Jeśli możesz założyć konto pod adresem {form.email.trim()}, otrzymasz link potwierdzający. Otwórz
              wiadomość i potwierdź rejestrację w ciągu 24 godzin.
            </Alert>
            <Text size="sm">
              Jeśli wiadomość nie dotarła, sprawdź folder Spam. Możesz wrócić do formularza, poprawić adres i ponowić
              wysyłkę.
            </Text>
            <Button variant="default" onClick={() => setSent(false)}>
              Wróć do formularza
            </Button>
            <Button onClick={() => navigate(`/login?next=${encodeURIComponent(next)}`)}>Przejdź do logowania</Button>
          </>
        ) : (
          <>
            <Text size="sm">
              Wyślemy e-mail z linkiem potwierdzającym. Rodzina i konto administratora powstaną dopiero po potwierdzeniu
              rejestracji.
            </Text>
            <form onSubmit={onSubmit} noValidate>
              <Stack gap="sm">
                <TextInput
                  label={labels.familyName}
                  aria-label={labels.familyName}
                  placeholder={labels.familyNameExample}
                  value={form.familyName}
                  onChange={(event) => onChange('familyName', event.currentTarget.value)}
                  error={fieldErrors.familyName}
                  required
                />
                <TextInput
                  label={labels.yourName}
                  aria-label={labels.yourName}
                  autoComplete="given-name"
                  value={form.displayName}
                  onChange={(event) => onChange('displayName', event.currentTarget.value)}
                  error={fieldErrors.displayName}
                  required
                />
                <TextInput
                  type="email"
                  autoComplete="email"
                  label={labels.email}
                  aria-label={labels.email}
                  value={form.email}
                  onChange={(event) => onChange('email', event.currentTarget.value)}
                  error={fieldErrors.email}
                  required
                />
                <PasswordInput
                  autoComplete="new-password"
                  label={labels.password}
                  aria-label={labels.password}
                  value={form.password}
                  onChange={(event) => onChange('password', event.currentTarget.value)}
                  error={fieldErrors.password}
                  required
                />
                <Checkbox
                  label={
                    <>
                      Akceptuję{' '}
                      <Anchor
                        href={native ? `https://rodzina.preficze.pl${termsPath}` : termsPath}
                        target={native ? undefined : '_blank'}
                        rel={native ? undefined : 'noopener'}
                        inherit
                        underline="always"
                      >
                        regulamin
                      </Anchor>
                    </>
                  }
                  checked={acceptedTerms}
                  onChange={(event) => {
                    setAcceptedTerms(event.currentTarget.checked);
                    setFieldErrors((current) => ({ ...current, acceptedTerms: '' }));
                  }}
                  aria-invalid={Boolean(fieldErrors.acceptedTerms)}
                  aria-describedby={fieldErrors.acceptedTerms ? termsErrorId : undefined}
                  error={
                    fieldErrors.acceptedTerms ? (
                      <span id={termsErrorId} role="alert">
                        {fieldErrors.acceptedTerms}
                      </span>
                    ) : undefined
                  }
                  required
                />
                {error ? (
                  <Alert color="red" role="alert">
                    {error}
                  </Alert>
                ) : null}
                <Group className="auth-actions" justify="space-between">
                  <Button
                    type="button"
                    variant="default"
                    onClick={() => navigate(`/login?next=${encodeURIComponent(next)}`)}
                  >
                    {labels.login}
                  </Button>
                  <Button type="submit" loading={pending}>
                    {labels.createFamily}
                  </Button>
                </Group>
              </Stack>
            </form>
          </>
        )}
      </Stack>
    </Paper>
  );
}

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setSession } = useMe();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const next = sanitizeNextPath(searchParams.get('next'));

  const onChange = (field: 'email' | 'password', value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: '' }));
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const nextErrors = {
      email: form.email.trim() && /.+@.+\..+/.test(form.email) ? '' : labels.loginEmailError,
      password: form.password.length >= 8 ? '' : labels.passwordError,
    };

    setFieldErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await apiFetch<SessionResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: form.email.trim(), password: form.password }),
      });
      await setSession(response.user, response.family);
      navigate(next, { replace: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : labels.loginError);
    } finally {
      setPending(false);
    }
  };

  return (
    <Paper className="auth-card" withBorder p="lg">
      <Stack gap="lg">
        <PageHeader title={labels.login} />
        <form onSubmit={onSubmit} noValidate>
          <Stack gap="sm">
            <TextInput
              type="email"
              autoComplete="email"
              label={labels.email}
              aria-label={labels.email}
              value={form.email}
              onChange={(event) => onChange('email', event.currentTarget.value)}
              error={fieldErrors.email}
              required
            />
            <PasswordInput
              autoComplete="current-password"
              label={labels.password}
              aria-label={labels.password}
              value={form.password}
              onChange={(event) => onChange('password', event.currentTarget.value)}
              error={fieldErrors.password}
              required
            />
            {error ? (
              <Alert color="red" role="alert">
                {error}
              </Alert>
            ) : null}
            <Group className="auth-actions" justify="space-between">
              <Button
                type="button"
                variant="default"
                onClick={() => navigate(`/register?next=${encodeURIComponent(next)}`)}
              >
                {labels.registerFamily}
              </Button>
              <Button type="submit" loading={pending}>
                {labels.login}
              </Button>
            </Group>
            <Button variant="subtle" onClick={() => navigate(`/login-child?next=${encodeURIComponent(next)}`)}>
              {labels.childLogin}
            </Button>
            <PasswordRecoveryLink />
          </Stack>
        </form>
      </Stack>
    </Paper>
  );
}
