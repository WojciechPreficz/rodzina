import type { AuthUser, Family, AuthMeResponse, AuthOkResponse } from '@rodzina/shared';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { focusManager, onlineManager, QueryClientContext } from '@tanstack/react-query';
import { Navigate, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { apiFetch, ApiRequestError, sanitizeNextPath } from './api.js';
import {
  stopShoppingPersistence,
  readShoppingSession,
  restoreShopping,
  SHOPPING_STORAGE_KEY,
  PENDING_LOGOUT_KEY,
} from './features/shopping/shoppingOffline.js';
import { clearNativeSession, invalidateSessionRequests, isAndroid } from './platform.js';
import { ScheduleSync } from './features/notifications/scheduleSync.js';
import { localScheduler } from './features/notifications/localSchedule.js';
import {
  accountId,
  familyMembersKey,
  OFFLINE_DATA_KEY,
  readOfflineData,
  restoreOfflineData,
  saveOfflineData,
  useOfflineStorageIssue,
  type OfflineSession,
} from './offlineData.js';
import { reportTransportFailure } from './connectivity.js';
import { listMembers } from './features/family/familyApi.js';
import { SYNC_INTERVAL_MS } from './queryClient.js';
import { Alert } from '@mantine/core';
import { calendarStore } from './features/calendar/calendarOffline.js';
import { CalendarPrefetch } from './features/calendar/CalendarPrefetch.js';
import { taskStore } from './features/tasks/taskOffline.js';
import { TaskPrefetch } from './features/tasks/taskQueries.js';
import { clearAccountData } from './accountStorage.js';

export type AuthState = {
  user: AuthUser | null;
  family: Family | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
  setSession: (user: AuthUser, family: Family) => void;
  logout: () => Promise<void>;
  familySyncedAt: number | undefined;
  familySyncError: string | undefined;
  familyConfirmed: boolean;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

function pendingWebLogout(value?: boolean) {
  try {
    if (value === true) localStorage.setItem(PENDING_LOGOUT_KEY, 'yes');
    if (value === false) localStorage.removeItem(PENDING_LOGOUT_KEY);
    return !!localStorage.getItem(PENDING_LOGOUT_KEY);
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children?: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [family, setFamily] = useState<Family | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useContext(QueryClientContext);
  const generation = useRef(0);
  const refreshRevision = useRef(0);
  const currentSession = useRef<OfflineSession | undefined>(undefined);
  const [familySyncedAt, setFamilySyncedAt] = useState<number>();
  const [familySyncError, setFamilySyncError] = useState<string>();
  const [familyConfirmed, setFamilyConfirmed] = useState(false);
  const storageIssue = useOfflineStorageIssue();

  const refresh = useCallback(async () => {
    const requestGeneration = generation.current;
    const revision = ++refreshRevision.current;
    const current = () => requestGeneration === generation.current && revision === refreshRevision.current;
    if (!currentSession.current && !pendingWebLogout()) {
      const saved = readOfflineData();
      const cached = saved?.session ?? readShoppingSession();
      if (cached) {
        calendarStore.activate(accountId(cached));
        taskStore.activate(accountId(cached));
        if (queryClient) {
          restoreShopping(queryClient, cached);
          if (saved) restoreOfflineData(queryClient, saved);
        }
        currentSession.current = cached;
        setUser(cached.user);
        setFamily(cached.family);
        setFamilySyncedAt(saved?.syncedAt);
        setIsLoading(false);
      }
    }
    try {
      if (!onlineManager.isOnline()) throw new TypeError('Offline');
      if (!isAndroid() && pendingWebLogout()) {
        await apiFetch('/api/auth/logout', { method: 'POST' });
        pendingWebLogout(false);
      }
      const response = await apiFetch<AuthMeResponse>('/api/auth/me');
      if (!current()) return;
      if (currentSession.current && accountId(currentSession.current) !== accountId(response)) {
        clearAccountData('account-changed', { queryClient });
        setFamilySyncedAt(undefined);
        setFamilyConfirmed(false);
      }
      currentSession.current = response;
      calendarStore.activate(accountId(response));
      taskStore.activate(accountId(response));
      if (queryClient) restoreShopping(queryClient, response);
      setUser(response.user);
      setFamily(response.family);
      setIsLoading(false);
      if (queryClient)
        await queryClient.cancelQueries({ queryKey: familyMembersKey(response.family.id, response.user.id) });
      if (!current()) return;
      const members = queryClient
        ? await queryClient.fetchQuery({
            queryKey: familyMembersKey(response.family.id, response.user.id),
            staleTime: 0,
            gcTime: Infinity,
            retry: false,
            networkMode: 'always',
            queryFn: async ({ signal }) => {
              const result = await listMembers(signal);
              signal.throwIfAborted();
              if (!current()) throw new DOMException('Session changed', 'AbortError');
              return result;
            },
          })
        : await listMembers();
      if (!current()) return;
      const syncedAt = Date.now();
      saveOfflineData(response, members, syncedAt);
      setFamilySyncedAt(syncedAt);
      setFamilySyncError(undefined);
      setFamilyConfirmed(true);
      reportTransportFailure(false);
    } catch (error) {
      if (!current()) return;
      setFamilyConfirmed(false);
      if (error instanceof ApiRequestError && [401, 403].includes(error.status)) {
        generation.current += 1;
        invalidateSessionRequests();
        clearAccountData('session-lost', { queryClient });
        currentSession.current = undefined;
        setUser(null);
        setFamily(null);
        setFamilySyncedAt(undefined);
        setIsLoading(false);
      } else if (error instanceof ApiRequestError) {
        reportTransportFailure(false);
        setFamilySyncError(error.message);
      }
    } finally {
      if (current()) setIsLoading(false);
    }
  }, [queryClient]);

  useEffect(() => {
    void refresh();
    const reconnect = onlineManager.subscribe((online) => {
      if (online) void refresh();
      else setFamilyConfirmed(false);
    });
    const focus = focusManager.subscribe((focused) => {
      if (focused) void refresh();
    });
    const interval = window.setInterval(() => {
      if (onlineManager.isOnline() && focusManager.isFocused()) void refresh();
    }, SYNC_INTERVAL_MS);
    return () => {
      refreshRevision.current += 1;
      reconnect();
      focus();
      window.clearInterval(interval);
      if (queryClient) stopShoppingPersistence(queryClient);
    };
  }, [queryClient, refresh]);

  const identity = user && family ? `${family.id}:${user.id}` : undefined;
  useEffect(() => {
    const loseSession = (removeStored: boolean) => {
      clearAccountData(removeStored ? 'session-lost' : 'storage-changed', {
        queryClient,
        invalidateSession: () => {
          if (isAndroid()) localScheduler.invalidate();
          generation.current += 1;
        },
      });
      setUser(null);
      setFamily(null);
      currentSession.current = undefined;
      setFamilyConfirmed(false);
      setFamilySyncedAt(undefined);
      setIsLoading(false);
    };
    const onSessionLost = () => loseSession(true);
    window.addEventListener('rodzina:session-lost', onSessionLost);
    const onStorage = (event: StorageEvent) => {
      if (
        (event.key === SHOPPING_STORAGE_KEY || event.key === OFFLINE_DATA_KEY || event.key === null) &&
        (!event.newValue ||
          (identity &&
            (() => {
              const stored = event.key === OFFLINE_DATA_KEY ? readOfflineData()?.session : readShoppingSession();
              return !stored || accountId(stored) !== identity;
            })()))
      )
        loseSession(false);
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('rodzina:session-lost', onSessionLost);
      window.removeEventListener('storage', onStorage);
    };
  }, [queryClient, identity]);

  const logout = async () => {
    await clearAccountData('logout', {
      queryClient,
      invalidateSession: () => {
        if (isAndroid()) localScheduler.invalidate();
        generation.current += 1;
        invalidateSessionRequests();
      },
      beforeQueryClear: async () => {
        currentSession.current = undefined;
        setUser(null);
        setFamily(null);
        setFamilyConfirmed(false);
        setFamilySyncedAt(undefined);
        if (!isAndroid()) pendingWebLogout(true);
        await queryClient?.cancelQueries();
      },
    });
    try {
      await apiFetch<AuthOkResponse>('/api/auth/logout', { method: 'POST' });
      pendingWebLogout(false);
    } catch (error) {
      if (!isAndroid() && error instanceof ApiRequestError) throw error;
    } finally {
      await clearNativeSession();
      setUser(null);
      setFamily(null);
    }
  };

  const setSession = (nextUser: AuthUser, nextFamily: Family) => {
    clearAccountData('account-changed', {
      queryClient,
      invalidateSession: () => {
        calendarStore.activate(`${nextFamily.id}:${nextUser.id}`);
        taskStore.activate(`${nextFamily.id}:${nextUser.id}`);
        if (isAndroid()) localScheduler.invalidate();
        generation.current += 1;
        invalidateSessionRequests();
        pendingWebLogout(false);
      },
    });
    if (queryClient) void restoreShopping(queryClient, { user: nextUser, family: nextFamily });
    setUser(nextUser);
    setFamily(nextFamily);
    currentSession.current = { user: nextUser, family: nextFamily };
    saveOfflineData(currentSession.current);
    setFamilyConfirmed(false);
    setFamilySyncedAt(undefined);
    setIsLoading(false);
    void refresh();
  };

  const value: AuthState = {
    user,
    family,
    isLoading,
    refresh,
    setSession,
    logout,
    familySyncedAt,
    familySyncError,
    familyConfirmed,
  };

  return (
    <AuthContext.Provider value={value}>
      {queryClient && user && family && <TaskPrefetch />}
      {queryClient && <ScheduleSync account={user ? `${user.familyId}:${user.id}` : ''} />}
      {queryClient && family && familyConfirmed && familySyncedAt && (
        <CalendarPrefetch confirmedAt={familySyncedAt} timezone={family.timezone} />
      )}
      {!user && storageIssue && <Alert color="red">{storageIssue}</Alert>}
      {children ?? <Outlet />}
    </AuthContext.Provider>
  );
}

export function AppRoot() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}

export function useMe(): AuthState {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useMe must be used inside AuthProvider.');
  }

  return context;
}

export function getSafeNextPath(search: string | undefined): string {
  const next = new URLSearchParams(search ?? '').get('next');
  return sanitizeNextPath(next);
}

export function ProtectedRoute({ children }: { children?: ReactNode }) {
  const { user, isLoading } = useMe();
  const location = useLocation();

  if (isLoading) {
    return null;
  }

  if (!user) {
    if (location.pathname === '/' && !location.search) {
      return <Navigate to="/witaj" replace />;
    }
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return children ?? <Outlet />;
}

export function PublicOnlyRoute({ children }: { children?: ReactNode }) {
  const { user, isLoading } = useMe();
  const [searchParams] = useSearchParams();

  if (isLoading) {
    return null;
  }

  if (user) {
    return <Navigate to={sanitizeNextPath(searchParams.get('next'))} replace />;
  }

  return children ?? <Outlet />;
}

export function LogoutButton() {
  const navigate = useNavigate();
  const { logout } = useMe();

  return (
    <button
      type="button"
      onClick={async () => {
        await logout();
        navigate('/login');
      }}
    >
      Wyloguj się
    </button>
  );
}
