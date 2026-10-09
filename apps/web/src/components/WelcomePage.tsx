import { Button, Paper, Stack, Text } from '@mantine/core';
import { Link } from 'react-router';
import { labels } from '../i18n/pl.js';

export function WelcomePage() {
  return (
    <Paper withBorder radius="lg" p="lg">
      <Stack gap="lg">
        <Text component="h2" size="xl" fw={700}>
          {labels.welcomeTitle}
        </Text>
        <Text c="dimmed">{labels.welcomeSubtitle}</Text>
        <Stack gap="sm">
          <Button component={Link} to="/register" size="lg" radius="md">
            {labels.registerFamily}
          </Button>
          <Button component={Link} to="/login" variant="light" size="lg" radius="md">
            {labels.login}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
