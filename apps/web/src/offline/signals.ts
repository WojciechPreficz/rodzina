export const OUTBOX_SIGNAL = 'offline-outbox-changed:1';
const observed = new WeakSet<IDBTransaction>();

// Notify only after commit: aborted writes must neither wake replay nor expose data.
export function notifyOutboxChanged(tx: IDBTransaction, accountId: string) {
  if (observed.has(tx)) return;
  observed.add(tx);
  tx.addEventListener('complete', () => {
    window.dispatchEvent(new CustomEvent(OUTBOX_SIGNAL, { detail: accountId }));
    try {
      if (typeof window.BroadcastChannel === 'function') {
        const channel = new window.BroadcastChannel(OUTBOX_SIGNAL);
        channel.postMessage(accountId);
        channel.close();
        return;
      }
    } catch {
      // Fall back when BroadcastChannel is unavailable or denied.
    }
    try {
      localStorage.setItem(OUTBOX_SIGNAL, JSON.stringify({ accountId, nonce: crypto.randomUUID() }));
    } catch {
      // IDB remains authoritative; online/focus and lease timers also resume replay.
    }
  });
}

export function watchOutbox(accountId: string, wake: () => void) {
  const local = (event: Event) => {
    if ((event as CustomEvent<unknown>).detail === accountId) wake();
  };
  const storage = (event: StorageEvent) => {
    if (event.key !== OUTBOX_SIGNAL || !event.newValue) return;
    try {
      if (JSON.parse(event.newValue).accountId === accountId) wake();
    } catch {
      // Ignore malformed coordination messages.
    }
  };
  let channel: BroadcastChannel | undefined;
  try {
    if (typeof window.BroadcastChannel === 'function') {
      channel = new window.BroadcastChannel(OUTBOX_SIGNAL);
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data === accountId) wake();
      };
    }
  } catch {
    // The storage listener remains available if channel construction is denied.
  }
  window.addEventListener(OUTBOX_SIGNAL, local);
  window.addEventListener('storage', storage);
  return () => {
    channel?.close();
    window.removeEventListener(OUTBOX_SIGNAL, local);
    window.removeEventListener('storage', storage);
  };
}
