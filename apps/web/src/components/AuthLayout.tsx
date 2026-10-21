import { Stack } from '@mantine/core';
import { Outlet, useLocation } from 'react-router';
import { AndroidDownload, AndroidUpdateNotice } from '../features/updates/AndroidUpdates.js';
import { AppBrand } from './AppBrand.js';

export function AuthLayout() {
  const { pathname } = useLocation();
  return (
    <Stack component="main" className="auth-layout" maw={520} mx="auto" p="md" gap="lg">
      <AppBrand />
      <AndroidUpdateNotice />
      <Outlet />
      {['/login', '/login-child', '/witaj'].includes(pathname) && <AndroidDownload />}
    </Stack>
  );
}
