import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { sanitizeNextPath } from './api.js';
import { AuthContext, useMe, type AuthState } from './sessionContext.js';

export function AuthProvider({ children, value }: { children?: ReactNode; value: AuthState }) {
  return <AuthContext.Provider value={value}>{children ?? <Outlet />}</AuthContext.Provider>;
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
