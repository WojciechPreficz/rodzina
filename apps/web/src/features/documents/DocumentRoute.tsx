import { Loader } from '@mantine/core';
import { AppShell } from '../../components/AppShell.js';
import { ProtectedRoute, useMe } from '../../auth.js';
import { isAndroid } from '../../platform.js';
import { useOffline } from '../../connectivity.js';
import { OfflineReminder } from '../notifications/OfflineReminder.js';
import { DocumentDetailsPage } from './DocumentDetailsPage.js';

export function DocumentRoute() {
  const { user, isLoading } = useMe();
  const offline = useOffline();
  if (isLoading) return <Loader />;
  if (isAndroid() && (!user || offline)) {
    const preview = <OfflineReminder />;
    return user ? <AppShell>{preview}</AppShell> : <div className="auth-layout">{preview}</div>;
  }
  return (
    <ProtectedRoute>
      <AppShell>
        <DocumentDetailsPage />
      </AppShell>
    </ProtectedRoute>
  );
}
