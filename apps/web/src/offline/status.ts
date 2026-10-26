import { useSyncExternalStore } from 'react';

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
