import type { AccountSession } from './session.js';
import type { AuthUser, Family, AuthMeResponse, AuthOkResponse, Member } from '@rodzina/shared';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { focusManager, onlineManager, QueryClientContext, type QueryClient } from '@tanstack/react-query';
import { apiFetch, ApiRequestError } from './api.js';
import { clearNativeSession, invalidateSessionRequests, isAndroid } from './platform.js';
import type { OfflineData } from './offlineData.js';
import type { AuthState } from './sessionContext.js';
import { reportTransportFailure } from './connectivity.js';
import { SYNC_INTERVAL_MS } from './queryClient.js';
import { clearAccountData, restoreAccountStores, stopAccountPersistence } from './accountStorage.js';
import {
  ACCOUNT_SIGNAL_KEY,
  activateOfflineAccount,
  announceAccount,
  recoverPendingClear,
} from './offline/database.js';
import { reportStorageIssue, storageError } from './offline/status.js';
export type AccountServices = {
  accountId: (session: AccountSession) => string;
  familyMembersKey: (familyId: string, userId: string) => readonly string[];
  hydrateOfflineData: () => Promise<OfflineData | undefined>;
  restoreOfflineData: (client: QueryClient, data: OfflineData) => void;
  saveOfflineData: (session: AccountSession, members?: AuthUser[], syncedAt?: number) => Promise<boolean>;
  listMembers: (signal?: AbortSignal) => Promise<Member[]>;
  readSession: () => Promise<AccountSession | undefined>;
  saveSession: (session: AccountSession) => Promise<boolean>;
  pendingLogoutKey: string;
  invalidateAlarms: () => void;
  migrationCompleted: () => void;
  foreignStorage: (event: StorageEvent, identity: string | undefined) => boolean;
};
function pendingWebLogout(key: string, value?: boolean) {
  try {
    if (value === true) localStorage.setItem(key, 'yes');
    if (value === false) localStorage.removeItem(key);
    return !!localStorage.getItem(key);
  } catch {
    return false;
  }
}

export function useAccountLifecycle(services: AccountServices) {
  const {
    accountId,
    familyMembersKey,
    hydrateOfflineData,
    restoreOfflineData,
    saveOfflineData,
    listMembers,
    readSession,
    saveSession,
  } = services;
  const pendingLogout = useCallback(
    (value?: boolean) => pendingWebLogout(services.pendingLogoutKey, value),
    [services],
  );
  const [user, setUser] = useState<AuthUser | null>(null);
  const [family, setFamily] = useState<Family | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useContext(QueryClientContext);
  const generation = useRef(0);
  const refreshRevision = useRef(0);
  const currentSession = useRef<AccountSession | undefined>(undefined);
  const sessionRejected = useRef(false);
  const [familySyncedAt, setFamilySyncedAt] = useState<number>();
  const [familySyncError, setFamilySyncError] = useState<string>();
  const [familyConfirmed, setFamilyConfirmed] = useState(false);

  const refresh = useCallback(async () => {
    const requestGeneration = generation.current;
    const revision = ++refreshRevision.current;
    const current = () => requestGeneration === generation.current && revision === refreshRevision.current;
    if (!currentSession.current && !pendingLogout()) {
      const cached = await readSession();
      if (!current()) return;
      const saved = cached ? await hydrateOfflineData() : undefined;
      if (!current()) return;
      if (cached) {
        await restoreAccountStores(cached, queryClient, current);
        if (!current()) return;
        if (queryClient) {
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
      if (!isAndroid() && pendingLogout()) {
        await apiFetch('/api/auth/logout', { method: 'POST' });
        pendingLogout(false);
      }
      const response = await apiFetch<AuthMeResponse>('/api/auth/me');
      if (!current()) return;
      if (currentSession.current && accountId(currentSession.current) !== accountId(response)) {
        await clearAccountData('account-changed', { queryClient });
        if (!current()) return;
        setFamilySyncedAt(undefined);
        setFamilyConfirmed(false);
      }
      currentSession.current = response;
      sessionRejected.current = false;
      await recoverPendingClear();
      if (!current()) return;
      try {
        await activateOfflineAccount(accountId(response), true);
      } catch (error) {
        reportStorageIssue(storageError(error));
      }
      if (!current()) return;
      await saveSession(response);
      if (!current()) return;
      await restoreAccountStores(response, queryClient, current);
      if (!current()) return;
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
      const persisted = await saveOfflineData(response, members, syncedAt);
      if (!current()) return;
      if (persisted) setFamilySyncedAt(syncedAt);
      setFamilySyncError(undefined);
      setFamilyConfirmed(true);
      reportTransportFailure(false);
    } catch (error) {
      if (!current()) return;
      setFamilyConfirmed(false);
      if (error instanceof ApiRequestError) {
        reportTransportFailure(false);
        setFamilySyncError(error.message);
      }
    } finally {
      if (current()) setIsLoading(false);
    }
  }, [
    queryClient,
    accountId,
    familyMembersKey,
    hydrateOfflineData,
    restoreOfflineData,
    saveOfflineData,
    listMembers,
    readSession,
    saveSession,
    pendingLogout,
  ]);

  useEffect(() => {
    void refresh();
    const refreshAutomatically = () => {
      if (!sessionRejected.current) void refresh();
    };
    const reconnect = onlineManager.subscribe((online) => {
      if (online) refreshAutomatically();
      else setFamilyConfirmed(false);
    });
    const focus = focusManager.subscribe((focused) => {
      if (focused) refreshAutomatically();
    });
    const interval = window.setInterval(() => {
      if (onlineManager.isOnline() && focusManager.isFocused()) refreshAutomatically();
    }, SYNC_INTERVAL_MS);
    return () => {
      refreshRevision.current += 1;
      reconnect();
      focus();
      window.clearInterval(interval);
      stopAccountPersistence(queryClient);
      generation.current += 1;
    };
  }, [queryClient, refresh]);

  const identity = user && family ? `${family.id}:${user.id}` : undefined;
  useEffect(() => {
    const loseSession = (removeStored: boolean) => {
      if (removeStored && sessionRejected.current) return;
      sessionRejected.current = removeStored;
      const clearing = clearAccountData(removeStored ? 'session-lost' : 'storage-changed', {
        queryClient,
        invalidateSession: () => {
          services.invalidateAlarms();
          generation.current += 1;
          invalidateSessionRequests();
        },
      });
      const cleanupGeneration = generation.current;
      setUser(null);
      setFamily(null);
      currentSession.current = undefined;
      setFamilyConfirmed(false);
      setFamilySyncedAt(undefined);
      setIsLoading(true);
      void clearing
        .catch(() => {})
        .finally(() => {
          if (generation.current === cleanupGeneration) setIsLoading(false);
        });
    };
    const onSessionLost = () => loseSession(true);
    window.addEventListener('rodzina:session-lost', onSessionLost);
    const onStorage = (event: StorageEvent) => {
      if (event.key === ACCOUNT_SIGNAL_KEY) {
        loseSession(false);
        return;
      }
      if (services.foreignStorage(event, identity)) loseSession(false);
      if (event.key === null) loseSession(false);
    };
    window.addEventListener('storage', onStorage);
    const onInvalidated = () => loseSession(false);
    window.addEventListener('offline-context-invalidated', onInvalidated);
    const onResumed = () => {
      void refresh();
    };
    window.addEventListener('offline-storage-resumed', onResumed);
    return () => {
      window.removeEventListener('rodzina:session-lost', onSessionLost);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('offline-context-invalidated', onInvalidated);
      window.removeEventListener('offline-storage-resumed', onResumed);
    };
  }, [queryClient, identity, refresh, services]);

  const logout = async (mode?: 'queue-checked') => {
    sessionRejected.current = true;
    let cleanupError: unknown;
    // A concurrent tab may queue a change between the UI check and this transaction.
    await clearAccountData(mode === 'queue-checked' ? 'logout-checked' : 'logout', {
      queryClient,
      invalidateSession: () => {
        services.invalidateAlarms();
        generation.current += 1;
        invalidateSessionRequests();
      },
      beforeQueryClear: async () => {
        currentSession.current = undefined;
        setUser(null);
        setFamily(null);
        setFamilyConfirmed(false);
        setFamilySyncedAt(undefined);
        if (!isAndroid()) pendingLogout(true);
        await queryClient?.cancelQueries();
      },
    }).catch((error: unknown) => {
      cleanupError = error;
    });
    try {
      await apiFetch<AuthOkResponse>('/api/auth/logout', { method: 'POST' });
      pendingLogout(false);
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) pendingLogout(false);
      else if (!isAndroid() && error instanceof ApiRequestError) throw error;
    } finally {
      await clearNativeSession();
      setUser(null);
      setFamily(null);
    }
    if (cleanupError) throw cleanupError;
  };

  const setSession = async (nextUser: AuthUser, nextFamily: Family) => {
    const clearing = clearAccountData('account-changed', {
      queryClient,
      invalidateSession: () => {
        services.invalidateAlarms();
        generation.current += 1;
        invalidateSessionRequests();
        pendingLogout(false);
      },
    });
    currentSession.current = undefined;
    setUser(null);
    setFamily(null);
    const requestGeneration = generation.current;
    const current = () => generation.current === requestGeneration;
    try {
      await clearing;
      if (!current()) return;
      try {
        await activateOfflineAccount(accountId({ user: nextUser, family: nextFamily }), true);
      } catch (error) {
        reportStorageIssue(storageError(error));
      }
      if (!current()) return;
      await saveSession({ user: nextUser, family: nextFamily });
      if (!current()) return;
      await restoreAccountStores({ user: nextUser, family: nextFamily }, queryClient, current);
      if (current()) announceAccount(services.accountId({ user: nextUser, family: nextFamily }));
      if (!current()) return;
      currentSession.current = { user: nextUser, family: nextFamily };
      sessionRejected.current = false;
      setUser(nextUser);
      setFamily(nextFamily);
      setFamilyConfirmed(false);
      setFamilySyncedAt(undefined);
      setIsLoading(false);
      await saveOfflineData(currentSession.current);
      if (current()) void refresh();
    } catch (error) {
      reportStorageIssue(`Nie można zmienić konta. ${storageError(error)}`);
    }
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

  return {
    value,
    migrationCompleted: async () => {
      services.migrationCompleted();
      currentSession.current = undefined;
      await refresh();
    },
  };
}
