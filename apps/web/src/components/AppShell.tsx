import { AppShell as MantineAppShell, Burger, Button, Divider, Drawer, NavLink, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { Link, Outlet, useLocation } from 'react-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useMe } from '../auth.js';
import { labels } from '../i18n/pl.js';
import { allowNavigation } from '../nativeNavigation.js';
import { isAndroid } from '../platform.js';
import { AndroidUpdateNotice } from '../features/updates/AndroidUpdates.js';

const navigation = [
  { label: labels.calendar, to: '/kalendarz', icon: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z' },
  { label: labels.tasksUi.title, to: '/zadania', icon: 'm4 6 2 2 4-4m-6 12 2 2 4-4M13 6h7M13 16h7' },
  { label: labels.shopping, to: '/zakupy', icon: 'M3 3h2l3 12h11l2-8H6M9 20h.01M18 20h.01' },
  { label: labels.meals, to: '/obiady', icon: 'M4 3v6a3 3 0 0 0 6 0V3M7 3v18M20 21V3c-4 2-5 8 0 9' },
  {
    label: labels.family,
    to: '/wiecej/rodzina',
    icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-4M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8 0a4 4 0 0 1 0 8',
  },
  {
    label: labels.notificationsUi.title,
    to: '/wiecej/powiadomienia',
    icon: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  },
  {
    label: labels.androidUpdates.title,
    to: '/wiecej',
    icon: 'M12 11v6m0-10h.01M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z',
  },
];

function NavigationIcon({ path }: { path: string }) {
  return (
    <svg
      width="21"
      height="21"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const { user, logout } = useMe();
  const location = useLocation();
  const wide = useMediaQuery('(min-width: 48em)');
  const native = isAndroid();
  const desktop = wide && !native;
  const [opened, setOpened] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  useEffect(() => setOpened(false), [location.key, desktop]);
  const active = (to: string) =>
    to === '/kalendarz'
      ? location.pathname === '/' || location.pathname.startsWith('/kalendarz')
      : to === '/wiecej'
        ? location.pathname === to
        : location.pathname === to || location.pathname.startsWith(`${to}/`);

  const menu = (
    <Stack className="app-navigation" gap="md">
      <Stack component="nav" aria-label={labels.navigation.main} gap={4}>
        {navigation.map(({ label, to, icon }, index) => (
          <div key={to}>
            {index === 4 && <Divider my="sm" />}
            <NavLink
              component={Link}
              to={to}
              label={label}
              leftSection={<NavigationIcon path={icon} />}
              active={active(to)}
              aria-current={active(to) ? 'page' : undefined}
              className="app-navigation-link"
              onClick={() => setOpened(false)}
            />
          </div>
        ))}
      </Stack>
      <Stack gap="xs" mt="auto" pt="md">
        <Divider />
        {user && (
          <div>
            <Text size="sm" fw={600}>
              {user.displayName}
            </Text>
            <Text size="xs" c="dimmed">
              {labels.roles[user.role]}
            </Text>
          </div>
        )}
        <Button
          variant="subtle"
          color="red"
          fullWidth
          justify="flex-start"
          mih={44}
          loading={loggingOut}
          onClick={async () => {
            if (!allowNavigation()) return;
            setLoggingOut(true);
            try {
              await logout();
            } finally {
              setLoggingOut(false);
            }
          }}
        >
          {labels.logout}
        </Button>
      </Stack>
    </Stack>
  );

  return (
    <MantineAppShell
      layout="alt"
      padding="md"
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: true, desktop: native } }}
    >
      {!desktop && (
        <div className="app-menu-toggle">
          <Burger
            {...(native ? {} : { hiddenFrom: 'sm' })}
            opened={opened}
            onClick={() => setOpened((value) => !value)}
            aria-label={labels.navigation.open}
            aria-expanded={opened}
            aria-controls="mobile-navigation-body"
            size="sm"
          />
        </div>
      )}
      {!native && (
        <MantineAppShell.Navbar visibleFrom="sm" className="app-sidebar" role="presentation">
          <Text size="xl" fw={800} c="teal.8" mb="xl">
            {labels.appName}
          </Text>
          {desktop && menu}
        </MantineAppShell.Navbar>
      )}
      <MantineAppShell.Main className={desktop ? '' : 'app-main-mobile'}>
        <Stack maw={1200} mx="auto" py="md" style={{ minWidth: 0 }}>
          <AndroidUpdateNotice />
          {children ?? <Outlet />}
        </Stack>
      </MantineAppShell.Main>
      <Drawer
        id="mobile-navigation"
        opened={opened && !desktop}
        onClose={() => setOpened(false)}
        position="right"
        size="min(340px, 85vw)"
        title={labels.navigation.title}
        closeButtonProps={{ 'aria-label': labels.navigation.close }}
        overlayProps={{ backgroundOpacity: 0.35 }}
        classNames={{ header: 'app-menu-header', body: 'app-menu-body' }}
      >
        {menu}
      </Drawer>
    </MantineAppShell>
  );
}
