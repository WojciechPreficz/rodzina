import { Stack } from '@mantine/core';
import { Outlet, useLocation } from 'react-router';
import { AndroidDownload } from '../features/updates/AndroidUpdates.js';

export function AuthLayout() {
  const { pathname } = useLocation();
  return (
    <Stack className="auth-layout" maw={480} mx="auto" p="md">
      <Outlet />
      {['/login', '/login-child', '/witaj'].includes(pathname) && <AndroidDownload />}
    </Stack>
  );
}
