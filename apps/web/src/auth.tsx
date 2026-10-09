import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { apiFetch, sanitizeNextPath } from './api.js';

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

export function AuthProvider({ children }: { children?: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [family, setFamily] = useState<Family | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = async () => {
    try {
      const response = await apiFetch<{ ok: boolean; user: AuthUser; family: Family }>('/api/auth/me');
      setUser(response.user);
      setFamily(response.family);
    } catch {
      setUser(null);
      setFamily(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const logout = async () => {
    try {
      await apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      setFamily(null);
    }
  };

  const setSession = (nextUser: AuthUser, nextFamily: Family) => {
    setUser(nextUser);
    setFamily(nextFamily);
    setIsLoading(false);
  };

  const value = useMemo<AuthState>(
    () => ({
      user,
      family,
      isLoading,
      refresh,
      setSession,
      logout,
    }),
    [family, isLoading, user],
  );

  return <AuthContext.Provider value={value}>{children ?? <Outlet />}</AuthContext.Provider>;
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
