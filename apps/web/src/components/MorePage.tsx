import { Button, Card, Group, Stack, Text } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useMe } from '../auth.js';
import { labels } from '../i18n/pl.js';

export function MorePage() {
  const { user, family, logout } = useMe();
  const queryClient = useQueryClient();

  return (
    <Card withBorder radius="lg" p="lg">
      <Stack gap="lg">
        <Text component="h2" size="xl" fw={700}>
          {labels.more}
        </Text>
        {user ? (
          <>
            <Text>
              {user.displayName} · {family?.name ?? labels.family}
            </Text>
            <Text c="dimmed">{labels.roles[user.role]}</Text>
          </>
        ) : null}
        <Button component={Link} to="/wiecej/rodzina" variant="light">
          {labels.family}
        </Button>
        <Group justify="flex-end">
          <Button
            color="red"
            onClick={async () => {
              await logout();
              queryClient.clear();
            }}
          >
            {labels.logout}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
