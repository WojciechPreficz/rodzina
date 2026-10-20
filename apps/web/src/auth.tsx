import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { Navigate, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { apiFetch, ApiRequestError, sanitizeNextPath } from './api.js';
import {
  clearShoppingStorage,
  stopShoppingPersistence,
  readShoppingSession,
  restoreShopping,
  SHOPPING_STORAGE_KEY,
  PENDING_LOGOUT_KEY,
} from './features/shopping/shoppingOffline.js';
import { clearNativeSession, invalidateSessionRequests, isAndroid } from './platform.js';
import { ScheduleSync } from './features/notifications/scheduleSync.js';
import { localScheduler } from './features/notifications/localSchedule.js';

export type AuthRole = 'admin' | 'member' | 'child';

export type Family = {
  id: string;
  name: string;
  timezone: string;
  joinCode: string;
};

export type AuthUser = {
  id: string;
  familyId: string;
  displayName: string;
  email: string | null;
  role: AuthRole;
  color: string;
  createdAt: number;
  updatedAt: number;
};

export type AuthState = {
  user: AuthUser | null;
  family: Family | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
  setSession: (user: AuthUser, family: Family) => void;
  logout: () => Promise<void>;
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

  const refresh = useCallback(async () => {
    const requestGeneration = generation.current;
    try {
      if (!isAndroid() && pendingWebLogout()) {
        await apiFetch('/api/auth/logout', { method: 'POST' });
        pendingWebLogout(false);
      }
      const response = await apiFetch<{ ok: boolean; user: AuthUser; family: Family }>('/api/auth/me');
      if (requestGeneration !== generation.current) return;
      if (queryClient) await restoreShopping(queryClient, response);
      if (requestGeneration !== generation.current) return;
      setUser(response.user);
      setFamily(response.family);
    } catch (error) {
      if (requestGeneration !== generation.current) return;
      const cached =
        error instanceof ApiRequestError && [401, 403].includes(error.status) ? undefined : readShoppingSession();
      if (cached && queryClient) {
        await restoreShopping(queryClient, cached);
        if (requestGeneration !== generation.current) return;
        setUser(cached.user);
        setFamily(cached.family);
      } else {
        clearShoppingStorage(queryClient);
        setUser(null);
        setFamily(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, [queryClient]);

  useEffect(() => {
    void refresh();
    return () => {
      if (queryClient) stopShoppingPersistence(queryClient);
    };
  }, [queryClient, refresh]);

  const userId = user?.id;
  useEffect(() => {
    const loseSession = (removeStored: boolean) => {
      if (isAndroid()) localScheduler.invalidate();
      generation.current += 1;
      if (removeStored) clearShoppingStorage(queryClient);
      else if (queryClient) stopShoppingPersistence(queryClient);
      queryClient?.clear();
      setUser(null);
      setFamily(null);
      setIsLoading(false);
    };
    const onSessionLost = () => loseSession(true);
    window.addEventListener('rodzina:session-lost', onSessionLost);
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === SHOPPING_STORAGE_KEY &&
        (!event.newValue || (userId && readShoppingSession()?.user.id !== userId))
      )
        loseSession(false);
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('rodzina:session-lost', onSessionLost);
      window.removeEventListener('storage', onStorage);
    };
  }, [queryClient, userId]);

  const logout = async () => {
    if (isAndroid()) localScheduler.invalidate();
    generation.current += 1;
    invalidateSessionRequests();
    clearShoppingStorage(queryClient);
    if (!isAndroid()) pendingWebLogout(true);
    await queryClient?.cancelQueries();
    queryClient?.clear();
    try {
      await apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
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
    if (isAndroid()) localScheduler.invalidate();
    generation.current += 1;
    invalidateSessionRequests();
    pendingWebLogout(false);
    clearShoppingStorage(queryClient);
    queryClient?.clear();
    if (queryClient) void restoreShopping(queryClient, { user: nextUser, family: nextFamily });
    setUser(nextUser);
    setFamily(nextFamily);
    setIsLoading(false);
  };

  const value: AuthState = {
    user,
    family,
    isLoading,
    refresh,
    setSession,
    logout,
  };

  return (
    <AuthContext.Provider value={value}>
      {queryClient && <ScheduleSync account={user ? `${user.familyId}:${user.id}` : ''} />}
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
