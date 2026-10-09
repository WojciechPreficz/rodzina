import { Alert, Button, Group, Paper, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { useNavigate, useSearchParams } from 'react-router';
import { useState } from 'react';
import { apiFetch, sanitizeNextPath } from '../api.js';
import { useMe, type AuthUser, type Family } from '../auth.js';

import { labels } from '../i18n/pl.js';

export function RegisterPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setSession } = useMe();
  const [form, setForm] = useState({ familyName: '', displayName: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const next = sanitizeNextPath(searchParams.get('next'));

  const onChange = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: '' }));
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors: Record<string, string> = {
      familyName: form.familyName.trim().length >= 2 ? '' : labels.familyNameError,
      displayName: form.displayName.trim().length >= 2 ? '' : labels.displayNameError,
      email: form.email.trim() && /.+@.+\..+/.test(form.email) ? '' : labels.emailError,
      password: form.password.length >= 8 ? '' : labels.passwordError,
    };

    setFieldErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      const response = await apiFetch<{ ok: boolean; user: AuthUser; family: Family }>('/api/auth/register-family', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          familyName: form.familyName.trim(),
          displayName: form.displayName.trim(),
          email: form.email.trim(),
        }),
      });
      setSession(response.user, response.family);
      navigate(next, { replace: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : labels.registrationError);
    }
  };

  return (
    <Paper withBorder radius="lg" p="lg">
      <Stack gap="lg">
        <Text component="h2" size="xl" fw={700}>
          {labels.registerFamily}
        </Text>
        <form onSubmit={onSubmit} noValidate>
          <Stack gap="sm">
            <TextInput
              label={labels.familyName}
              aria-label={labels.familyName}
              value={form.familyName}
              onChange={(event) => onChange('familyName', event.currentTarget.value)}
              error={fieldErrors.familyName}
              required
            />
            <TextInput
              label={labels.displayName}
              aria-label={labels.displayName}
              value={form.displayName}
              onChange={(event) => onChange('displayName', event.currentTarget.value)}
              error={fieldErrors.displayName}
              required
            />
            <TextInput
              type="email"
              label={labels.email}
              aria-label={labels.email}
              value={form.email}
              onChange={(event) => onChange('email', event.currentTarget.value)}
              error={fieldErrors.email}
              required
            />
            <PasswordInput
              label={labels.password}
              aria-label={labels.password}
              value={form.password}
              onChange={(event) => onChange('password', event.currentTarget.value)}
              error={fieldErrors.password}
              required
            />
            {error ? <Alert color="red">{error}</Alert> : null}
            <Group justify="space-between">
              <Button
                type="button"
                variant="default"
                onClick={() => navigate(`/login?next=${encodeURIComponent(next)}`)}
              >
                {labels.login}
              </Button>
              <Button type="submit">{labels.createFamily}</Button>
            </Group>
          </Stack>
        </form>
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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const next = sanitizeNextPath(searchParams.get('next'));

  const onChange = (field: 'email' | 'password', value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => ({ ...current, [field]: '' }));
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors = {
      email: form.email.trim() && /.+@.+\..+/.test(form.email) ? '' : labels.loginEmailError,
      password: form.password.length >= 8 ? '' : labels.passwordError,
    };

    setFieldErrors(nextErrors);

    if (Object.values(nextErrors).some(Boolean)) {
      return;
    }

    try {
      const response = await apiFetch<{ ok: boolean; user: AuthUser; family: Family }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: form.email.trim(), password: form.password }),
      });
      setSession(response.user, response.family);
      navigate(next, { replace: true });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : labels.loginError);
    }
  };

  return (
    <Paper withBorder radius="lg" p="lg">
      <Stack gap="lg">
        <Text component="h2" size="xl" fw={700}>
          {labels.login}
        </Text>
        <form onSubmit={onSubmit} noValidate>
          <Stack gap="sm">
            <TextInput
              type="email"
              label={labels.email}
              aria-label={labels.email}
              value={form.email}
              onChange={(event) => onChange('email', event.currentTarget.value)}
              error={fieldErrors.email}
              required
            />
            <PasswordInput
              label={labels.password}
              aria-label={labels.password}
              value={form.password}
              onChange={(event) => onChange('password', event.currentTarget.value)}
              error={fieldErrors.password}
              required
            />
            {error ? <Alert color="red">{error}</Alert> : null}
            <Group justify="space-between">
              <Button
                type="button"
                variant="default"
                onClick={() => navigate(`/register?next=${encodeURIComponent(next)}`)}
              >
                {labels.registerFamily}
              </Button>
              <Button type="submit">{labels.login}</Button>
            </Group>
            <Button variant="subtle" onClick={() => navigate(`/login-child?next=${encodeURIComponent(next)}`)}>
              {labels.childLogin}
            </Button>
          </Stack>
        </form>
      </Stack>
    </Paper>
  );
}
