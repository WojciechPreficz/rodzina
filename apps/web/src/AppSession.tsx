import { useContext, type ReactNode } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { Outlet } from 'react-router';
import { AuthProvider } from './auth.js';
import { useMe } from './sessionContext.js';
import { useAccountLifecycle } from './accountLifecycle.js';
import { accountServices, registerApplicationStores } from './accountAdapters.js';
import { TaskPrefetch } from './features/tasks/taskQueries.js';
import { CalendarPrefetch } from './features/calendar/CalendarPrefetch.js';
import { ScheduleSync } from './features/notifications/scheduleSync.js';
import { MigrationNotice } from './offline/MigrationNotice.js';
import { useOfflineStorageIssue, useMigrationRequired } from './offline/status.js';
import { isAndroid } from './platform.js';
import './offline/notices.css';

registerApplicationStores();

function SessionEffects() {
  const { user, family, familyConfirmed, familySyncedAt } = useMe();
  return (
    <>
      {user && family && <TaskPrefetch />}
      <ScheduleSync account={user ? `${user.familyId}:${user.id}` : ''} />
      {family && familyConfirmed && familySyncedAt && (
        <CalendarPrefetch confirmedAt={familySyncedAt} timezone={family.timezone} />
      )}
    </>
  );
}

export function AppSession({ children }: { children?: ReactNode }) {
  const { value, migrationCompleted } = useAccountLifecycle(accountServices);
  const { user } = value;
  const queryClient = useContext(QueryClientContext);
  const storageIssue = useOfflineStorageIssue();
  const migrationRequired = useMigrationRequired();
  return (
    <AuthProvider value={value}>
      {queryClient && <SessionEffects key={user ? user.familyId + ':' + user.id : ''} />}
      {(storageIssue || migrationRequired) && (
        <div className={`offline-storage-notices${user ? ' authenticated' : ''}${isAndroid() ? ' native' : ''}`}>
          <MigrationNotice onMigrated={migrationCompleted} />
          {storageIssue && (!migrationRequired || !storageIssue.includes('wymagają przeniesienia')) && (
            <div className="offline-storage-error" role="alert">
              {storageIssue}
            </div>
          )}
        </div>
      )}

      {children ?? <Outlet />}
    </AuthProvider>
  );
}
