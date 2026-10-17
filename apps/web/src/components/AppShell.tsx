import { AppShell as MantineAppShell, Group, NavLink, Stack, Text } from '@mantine/core';
import { NavLink as RouterNavLink, Outlet } from 'react-router';
import { labels } from '../i18n/pl.js';
import type { ReactNode } from 'react';

const navigation = [
  { label: labels.calendar, to: '/' },
  { label: labels.shopping, to: '/zakupy' },
  { label: labels.meals, to: '/obiady' },
  { label: labels.more, to: '/wiecej' },
];

export function AppShell({ children }: { children?: ReactNode }) {
  return (
    <MantineAppShell padding="md" footer={{ height: 68 }}>
      <MantineAppShell.Main>
        <Stack maw={1200} mx="auto" py="md" style={{ minWidth: 0 }}>
          <Text component="h1" size="xl" fw={700} c="teal.8">
            {labels.appName}
          </Text>
          {children ?? <Outlet />}
        </Stack>
      </MantineAppShell.Main>
      <MantineAppShell.Footer>
        <Group component="nav" aria-label="Nawigacja główna" grow gap={0} h="100%">
          {navigation.map(({ label, to }) => (
            <NavLink key={to} component={RouterNavLink} to={to === '/' ? '/kalendarz' : to} label={label} h="100%" />
          ))}
        </Group>
      </MantineAppShell.Footer>
    </MantineAppShell>
  );
}
