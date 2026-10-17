import { Stack } from '@mantine/core';
import { Outlet } from 'react-router';

export function AuthLayout() {
  return (
    <Stack className="auth-layout" maw={480} mx="auto" p="md">
      <Outlet />
    </Stack>
  );
}
