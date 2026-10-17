import { Loader } from '@mantine/core';
import { AppShell } from '../../components/AppShell.js';
import { ProtectedRoute, useMe } from '../../auth.js';
import { isAndroid } from '../../platform.js';
import { OfflineReminder } from '../notifications/OfflineReminder.js';
import { EventDetailsPage } from './EventDetailsPage.js';

export function EventRoute() {
  const { user, isLoading } = useMe();
  if (isLoading) return <Loader />;
  if (!user && isAndroid())
    return (
      <div className="auth-layout" style={{ maxWidth: 800, margin: 'auto', padding: 16 }}>
        <OfflineReminder />
      </div>
    );
  return (
    <ProtectedRoute>
      <AppShell>
        <EventDetailsPage />
      </AppShell>
    </ProtectedRoute>
  );
}
