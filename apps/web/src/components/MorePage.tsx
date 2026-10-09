import { Button, Card, Group, Stack, Text } from '@mantine/core';
import { useMe } from '../auth.js';
import { labels } from '../i18n/pl.js';

export function MorePage() {
  const { user, family, logout } = useMe();

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
            <Text c="dimmed">{user.role}</Text>
          </>
        ) : null}
        <Group justify="flex-end">
          <Button
            color="red"
            onClick={async () => {
              await logout();
            }}
          >
            {labels.logout}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
