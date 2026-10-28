import { Loader } from '@mantine/core';
import { AppShell } from '../../components/AppShell.js';
import { ProtectedRoute } from '../../auth.js';
import { useMe } from '../../sessionContext.js';
import { isAndroid } from '../../platform.js';
import { OfflineReminder } from '../notifications/OfflineReminder.js';
import { EventDetailsPage } from './EventDetailsPage.js';
import { AndroidUpdateNotice } from '../updates/AndroidUpdates.js';

export function EventRoute() {
  const { user, isLoading } = useMe();
  if (isLoading) return <Loader />;
  if (!user && isAndroid())
    return (
      <div className="auth-layout" style={{ maxWidth: 800, margin: 'auto', padding: 16 }}>
        <AndroidUpdateNotice />
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
