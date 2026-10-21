import { PageHeader } from './PageHeader.js';
import { Button, Paper, Stack, Text } from '@mantine/core';
import { Link } from 'react-router';
import { labels } from '../i18n/pl.js';

export function WelcomePage() {
  return (
    <Paper className="auth-card" withBorder p="lg">
      <Stack gap="lg">
        <PageHeader title={labels.welcomeTitle} />
        <Text c="dimmed">{labels.welcomeSubtitle}</Text>
        <Stack gap="sm">
          <Button component={Link} to="/register" size="lg" radius="md">
            {labels.registerFamily}
          </Button>
          <Button component={Link} to="/login" variant="light" size="lg" radius="md">
            {labels.login}
          </Button>
          <Button component={Link} to="/login-child" variant="default" size="lg" radius="md">
            {labels.childLogin}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
