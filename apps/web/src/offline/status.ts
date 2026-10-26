import { useSyncExternalStore } from 'react';
import { onlineManager } from '@tanstack/react-query';

let issue: string | undefined;
let migrationRequired = false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export function reportStorageIssue(message?: string) {
  issue = message;
  listeners.forEach((listener) => listener());
}
export function requireMigration(required: boolean) {
  migrationRequired = required;
  listeners.forEach((listener) => listener());
}
export const useOfflineStorageIssue = () => useSyncExternalStore(subscribe, () => issue);
export const useMigrationRequired = () => useSyncExternalStore(subscribe, () => migrationRequired);
type SyncStatus = {
  pendingCount: number;
  reviewCount: number;
  syncing: boolean;
  lastError?: string | undefined;
  lastSyncedAt?: number | null;
  sessionConfirmed?: boolean;
};
const emptySync: SyncStatus = { pendingCount: 0, reviewCount: 0, syncing: false };
const syncStatuses = new Map<string, SyncStatus>();
export function publishSyncStatus(accountId: string, module: string, status?: SyncStatus) {
  const key = `${accountId}/${module}`;
  if (status) syncStatuses.set(key, status);
  else syncStatuses.delete(key);
  listeners.forEach((listener) => listener());
}
export function useOfflineSyncStatus(accountId: string, module: string) {
  const status = useSyncExternalStore(subscribe, () => syncStatuses.get(`${accountId}/${module}`) ?? emptySync);
  const storageIssue = useOfflineStorageIssue();
  const online = useSyncExternalStore(onlineManager.subscribe, () => onlineManager.isOnline());
  const migrating = useMigrationRequired();
  return { ...status, storageIssue, offline: !online, migrating, hydrating: status === emptySync };
}
export function storageError(error: unknown) {
  if (error instanceof SyntaxError || (error instanceof Error && error.name === 'ZodError'))
    return 'Zapisane dane mają nieobsługiwany lub uszkodzony format. Połącz się z internetem, aby pobrać je ponownie.';
  if (error instanceof DOMException && error.name === 'QuotaExceededError')
    return 'Brak miejsca na urządzeniu. Zwolnij miejsce i spróbuj ponownie.';
  if (error instanceof DOMException && error.name === 'SecurityError')
    return 'Dostęp do pamięci urządzenia jest zablokowany.';
  if (error instanceof DOMException && error.name === 'AbortError')
    return 'Zapis przerwano po zmianie sesji. Spróbuj ponownie.';
  return error instanceof Error ? error.message : 'Nie można uzyskać dostępu do pamięci offline.';
}
