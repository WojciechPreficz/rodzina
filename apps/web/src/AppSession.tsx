import { useContext, type ReactNode } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { Outlet } from 'react-router';
import { AuthProvider } from './auth.js';
import { useMe } from './sessionContext.js';
import { useAccountLifecycle } from './accountLifecycle.js';
import { accountServices, registerApplicationStores } from './accountAdapters.js';
import { TaskPrefetch } from './features/tasks/index.js';
import { CalendarPrefetch } from './features/calendar/index.js';
import { ScheduleSync } from './reminders/scheduleSync.js';
import { useOfflineStorageIssue } from './offline/status.js';
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
  const { value } = useAccountLifecycle(accountServices);
  const { user } = value;
  const queryClient = useContext(QueryClientContext);
  const storageIssue = useOfflineStorageIssue();
  return (
    <AuthProvider value={value}>
      {queryClient && <SessionEffects key={user ? user.familyId + ':' + user.id : ''} />}
      {storageIssue && (
        <div className={`offline-storage-notices${user ? ' authenticated' : ''}${isAndroid() ? ' native' : ''}`}>
          <div className="offline-storage-error" role="alert">
            {storageIssue}
          </div>
        </div>
      )}

      {children ?? <Outlet />}
    </AuthProvider>
  );
}
