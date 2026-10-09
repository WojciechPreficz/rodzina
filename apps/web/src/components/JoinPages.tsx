import {
  Alert,
  Button,
  ColorSwatch,
  Group,
  Loader,
  Paper,
  PasswordInput,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { apiFetch, sanitizeNextPath } from '../api.js';
import { useMe, type AuthUser, type Family } from '../auth.js';
import { labels } from '../i18n/pl.js';
import { errorMessage, validateDisplayName, validatePin } from '../features/family/familyRules.js';

type SessionResponse = { user: AuthUser; family: Family };
type ChildProfile = Pick<AuthUser, 'id' | 'displayName' | 'color'>;

export function ChildLoginPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setSession } = useMe();
  const [joinCode, setJoinCode] = useState('');
  const [members, setMembers] = useState<ChildProfile[] | null>(null);
  const [selected, setSelected] = useState<ChildProfile | null>(null);
  const [pin, setPin] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const findFamily = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^[A-Z2-9]{6}$/.test(joinCode)) {
      setError(labels.joinCodeError);
      return;
    }
    setPending(true);
    setError('');
    try {
      const response = await apiFetch<{ members: ChildProfile[] }>(
        `/api/auth/family-members?joinCode=${encodeURIComponent(joinCode)}`,
      );
      setMembers(response.members);
    } catch (requestError) {
      setError(errorMessage(requestError, labels.profileError));
    } finally {
      setPending(false);
    }
  };

  const login = async (event: FormEvent) => {
    event.preventDefault();
    const pinError = validatePin(pin);
    if (!selected || pinError) {
      setError(pinError);
      return;
    }
    setPending(true);
    setError('');
    try {
      const response = await apiFetch<SessionResponse>('/api/auth/login-child', {
        method: 'POST',
        body: JSON.stringify({ joinCode, userId: selected.id, pin }),
      });
      setSession(response.user, response.family);
      navigate(sanitizeNextPath(searchParams.get('next')), { replace: true });
    } catch (requestError) {
      setError(errorMessage(requestError, labels.loginError));
      setPin('');
    } finally {
      setPending(false);
    }
  };

  return (
    <Paper withBorder radius="lg" p="lg">
      <Stack>
        <Text component="h2" size="xl" fw={700}>
          {labels.childLogin}
        </Text>
        {error ? (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        ) : null}
        {!members ? (
          <form onSubmit={findFamily}>
            <Stack>
              <TextInput
                label={labels.joinCode}
                autoComplete="off"
                maxLength={6}
                value={joinCode}
                onChange={(e) => setJoinCode(e.currentTarget.value.trim().toUpperCase())}
                required
              />
              <Button type="submit" loading={pending}>
                {labels.findFamily}
              </Button>
            </Stack>
          </form>
        ) : !selected ? (
          <Stack>
            <Text>{labels.chooseProfile}</Text>
            {members.length === 0 ? <Text>{labels.noChildren}</Text> : null}
            <SimpleGrid cols={2}>
              {members.map((member) => (
                <Button
                  key={member.id}
                  variant="light"
                  h="auto"
                  py="md"
                  onClick={() => {
                    setSelected(member);
                    setPin('');
                    setError('');
                  }}
                >
                  <Group gap="xs" wrap="wrap">
                    <ColorSwatch color={member.color} size={20} />
                    <Text style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{member.displayName}</Text>
                  </Group>
                </Button>
              ))}
            </SimpleGrid>
            <Button
              variant="default"
              onClick={() => {
                setMembers(null);
                setError('');
              }}
            >
              {labels.changeFamily}
            </Button>
          </Stack>
        ) : (
          <form onSubmit={login}>
            <Stack>
              <Text fw={600}>{selected.displayName}</Text>
              <PasswordInput
                label={labels.pin}
                description={labels.pinHint}
                inputMode="numeric"
                autoComplete="current-password"
                maxLength={6}
                value={pin}
                disabled={pending}
                onChange={(e) => setPin(e.currentTarget.value.replace(/\D/g, ''))}
              />
              <SimpleGrid cols={3}>
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((digit) => (
                  <Button
                    key={digit}
                    variant="light"
                    size="lg"
                    aria-label={`${labels.digit} ${digit}`}
                    disabled={pending || pin.length >= 6}
                    onClick={() => setPin((value) => value + digit)}
                  >
                    {digit}
                  </Button>
                ))}
                <Button
                  variant="default"
                  aria-label={labels.removeDigit}
                  disabled={pending || !pin}
                  onClick={() => setPin((value) => value.slice(0, -1))}
                >
                  ⌫
                </Button>
              </SimpleGrid>
              <Button type="submit" loading={pending}>
                {labels.login}
              </Button>
              <Button
                variant="default"
                disabled={pending}
                onClick={() => {
                  setSelected(null);
                  setPin('');
                  setError('');
                }}
              >
                {labels.changeProfile}
              </Button>
            </Stack>
          </form>
        )}
        <Button
          component={Link}
          to={`/login?next=${encodeURIComponent(sanitizeNextPath(searchParams.get('next')))}`}
          variant="subtle"
        >
          {labels.back}
        </Button>
      </Stack>
    </Paper>
  );
}

export function InvitationPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { user, isLoading, setSession, logout } = useMe();
  const queryClient = useQueryClient();
  const preview = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => apiFetch<{ family: { name: string } }>(`/api/invitations/${encodeURIComponent(token)}`),
    retry: false,
  });
  const [form, setForm] = useState({ displayName: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({ displayName: '', email: '', password: '' });

  const accept = async (event: FormEvent) => {
    event.preventDefault();
    const errors = {
      displayName: validateDisplayName(form.displayName),
      email: /.+@.+\..+/.test(form.email.trim()) ? '' : labels.emailError,
      password: form.password.length >= 8 ? '' : labels.passwordError,
    };
    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) return;
    setPending(true);
    setError('');
    try {
      const response = await apiFetch<SessionResponse>(`/api/invitations/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        body: JSON.stringify({ ...form, displayName: form.displayName.trim(), email: form.email.trim() }),
      });
      queryClient.clear();
      setSession(response.user, response.family);
      navigate('/', { replace: true });
    } catch (requestError) {
      setError(errorMessage(requestError, labels.invitationError));
    } finally {
      setPending(false);
    }
  };

  return (
    <Paper withBorder radius="lg" p="lg">
      <Stack>
        <Text component="h2" size="xl" fw={700}>
          {labels.invitationTitle}
        </Text>
        {preview.isPending || isLoading ? (
          <Group>
            <Loader size="sm" />
            <Text>{labels.invitationLoading}</Text>
          </Group>
        ) : preview.error ? (
          <Alert color="red" role="alert">
            {errorMessage(preview.error, labels.invitationError)}
          </Alert>
        ) : (
          <>
            <Text fw={600}>{preview.data.family.name}</Text>
            {user ? (
              <>
                <Text>{labels.alreadyLoggedIn}</Text>
                <Button
                  onClick={async () => {
                    try {
                      await logout();
                      queryClient.clear();
                    } catch (requestError) {
                      setError(errorMessage(requestError, labels.saveError));
                    }
                  }}
                >
                  {labels.logout}
                </Button>
              </>
            ) : (
              <form onSubmit={accept} noValidate>
                <Stack>
                  <TextInput
                    label={labels.displayName}
                    autoComplete="name"
                    required
                    value={form.displayName}
                    error={fieldErrors.displayName}
                    onChange={(e) => setForm({ ...form, displayName: e.currentTarget.value })}
                  />
                  <TextInput
                    label={labels.email}
                    type="email"
                    autoComplete="email"
                    required
                    value={form.email}
                    error={fieldErrors.email}
                    onChange={(e) => setForm({ ...form, email: e.currentTarget.value })}
                  />
                  <PasswordInput
                    label={labels.password}
                    autoComplete="new-password"
                    required
                    value={form.password}
                    error={fieldErrors.password}
                    onChange={(e) => setForm({ ...form, password: e.currentTarget.value })}
                  />
                  <Button type="submit" loading={pending}>
                    {labels.acceptInvitation}
                  </Button>
                </Stack>
              </form>
            )}
          </>
        )}
        {error ? (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        ) : null}
        <Button component={Link} to="/" variant="subtle">
          {labels.back}
        </Button>
      </Stack>
    </Paper>
  );
}

export function ResetPasswordPage() {
  const { token = '' } = useParams();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8) {
      setError(labels.passwordError);
      return;
    }
    if (password !== confirmation) {
      setError(labels.passwordMismatch);
      return;
    }
    setPending(true);
    setError('');
    try {
      await apiFetch('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
      setPassword('');
      setConfirmation('');
      setSuccess(true);
    } catch (requestError) {
      setError(errorMessage(requestError, labels.resetError));
    } finally {
      setPending(false);
    }
  };
  return (
    <Paper withBorder radius="lg" p="lg">
      <Stack>
        <Text component="h2" size="xl" fw={700}>
          {labels.resetPassword}
        </Text>
        {success ? (
          <Alert color="green" role="status">
            {labels.resetSuccess}
          </Alert>
        ) : (
          <form onSubmit={submit} noValidate>
            <Stack>
              <PasswordInput
                label={labels.newPassword}
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
              <PasswordInput
                label={labels.confirmPassword}
                autoComplete="new-password"
                required
                value={confirmation}
                onChange={(e) => setConfirmation(e.currentTarget.value)}
              />
              <Button type="submit" loading={pending}>
                {labels.save}
              </Button>
            </Stack>
          </form>
        )}
        {error ? (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        ) : null}
        <Button component={Link} to="/login" variant="subtle">
          {labels.login}
        </Button>
      </Stack>
    </Paper>
  );
}
