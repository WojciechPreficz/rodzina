import type { AuthUser, Family } from '@rodzina/shared';
import { createContext, useContext } from 'react';

export type AuthState = {
  user: AuthUser | null;
  family: Family | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
  setSession: (user: AuthUser, family: Family) => Promise<void>;
  logout: () => Promise<void>;
  familySyncedAt: number | undefined;
  familySyncError: string | undefined;
  familyConfirmed: boolean;
};

export const AuthContext = createContext<AuthState | undefined>(undefined);

export function useMe(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useMe must be used inside AuthProvider.');
  return context;
}
