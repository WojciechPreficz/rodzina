import { AppShell as MantineAppShell, Group, NavLink, Stack, Text } from '@mantine/core';
import { NavLink as RouterNavLink, Outlet } from 'react-router';
import { labels } from '../i18n/pl.js';

const navigation = [
  { label: labels.calendar, to: '/' },
  { label: labels.shopping, to: '/zakupy' },
  { label: labels.meals, to: '/obiady' },
  { label: labels.more, to: '/wiecej' },
];

export function AppShell() {
  return (
    <MantineAppShell padding="md" footer={{ height: 68 }}>
      <MantineAppShell.Main>
        <Stack maw={760} mx="auto" py="md">
          <Text component="h1" size="xl" fw={700} c="teal.8">
            {labels.appName}
          </Text>
          <Outlet />
        </Stack>
      </MantineAppShell.Main>
      <MantineAppShell.Footer>
        <Group component="nav" aria-label="Nawigacja główna" grow gap={0} h="100%">
          {navigation.map(({ label, to }) => (
            <NavLink key={to} component={RouterNavLink} to={to} label={label} end={to === '/'} h="100%" />
          ))}
        </Group>
      </MantineAppShell.Footer>
    </MantineAppShell>
  );
}
