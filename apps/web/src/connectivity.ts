import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

let transportFailed = false;
const listeners = new Set<() => void>();
export function reportTransportFailure(failed: boolean) {
  if (failed === transportFailed) return;
  transportFailed = failed;
  listeners.forEach((listener) => listener());
}
export const isOffline = () => !onlineManager.isOnline() || transportFailed;
export function useOffline() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    const stop = onlineManager.subscribe(listener);
    return () => {
      listeners.delete(listener);
      stop();
    };
  }, isOffline);
}
