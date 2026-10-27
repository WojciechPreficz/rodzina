import './testSetup.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activateOfflineAccount, transact } from './database.js';
import { notifyOutboxChanged, OUTBOX_SIGNAL, watchOutbox } from './signals.js';

afterEach(() => vi.unstubAllGlobals());

describe('outbox commit signals', () => {
  it('broadcasts once per committed transaction and filters account messages', async () => {
    const channels: Channel[] = [];
    class Channel {
      onmessage?: (event: MessageEvent<unknown>) => void;
      postMessage = vi.fn();
      close = vi.fn();
      constructor(readonly name: string) {
        channels.push(this);
      }
    }
    vi.stubGlobal('BroadcastChannel', Channel);
    const wake = vi.fn();
    const stop = watchOutbox('family:user', wake);
    try {
      await activateOfflineAccount('family:user');
      await transact('readwrite', async (tx) => {
        tx.objectStore('metadata').put({ accountId: 'family:user', key: 'test', value: 1 });
        notifyOutboxChanged(tx, 'family:user');
        notifyOutboxChanged(tx, 'family:user');
        expect(wake).not.toHaveBeenCalled();
      });
      expect(wake).toHaveBeenCalledOnce();
      expect(channels).toHaveLength(2);
      expect(channels[1]!.postMessage).toHaveBeenCalledExactlyOnceWith('family:user');
      expect(channels[1]!.close).toHaveBeenCalledOnce();
      expect(localStorage.getItem(OUTBOX_SIGNAL)).toBeNull();
      channels[0]!.onmessage?.(new MessageEvent('message', { data: 'other:account' }));
      expect(wake).toHaveBeenCalledOnce();
      channels[0]!.onmessage?.(new MessageEvent('message', { data: 'family:user' }));
      expect(wake).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
    expect(channels[0]!.close).toHaveBeenCalledOnce();
  });
  it('falls back to storage if BroadcastChannel construction is denied', async () => {
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        constructor() {
          throw new Error('Denied');
        }
      },
    );
    const wake = vi.fn();
    const stop = watchOutbox('family:user', wake);
    try {
      await activateOfflineAccount('family:user');
      await transact('readwrite', async (tx) => {
        tx.objectStore('metadata').put({ accountId: 'family:user', key: 'test', value: 1 });
        notifyOutboxChanged(tx, 'family:user');
      });
      const value = localStorage.getItem(OUTBOX_SIGNAL)!;
      expect(JSON.parse(value)).toMatchObject({ accountId: 'family:user' });
      window.dispatchEvent(new StorageEvent('storage', { key: OUTBOX_SIGNAL, newValue: value }));
      expect(wake).toHaveBeenCalledTimes(2);
      window.dispatchEvent(new StorageEvent('storage', { key: OUTBOX_SIGNAL, newValue: '{broken' }));
      expect(wake).toHaveBeenCalledTimes(2);
    } finally {
      stop();
    }
    window.dispatchEvent(new CustomEvent(OUTBOX_SIGNAL, { detail: 'family:user' }));
    expect(wake).toHaveBeenCalledTimes(2);
  });
});
