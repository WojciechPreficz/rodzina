import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ScheduleSync, refreshLocalSchedule, useLocalSchedule } from './scheduleSync.js';

const mocks = vi.hoisted(() => ({
  app: undefined as undefined | ((value: { isActive: boolean }) => void),
  network: undefined as undefined | ((value: { connected: boolean }) => void),
  remove: vi.fn(),
  sync: vi.fn(),
  permissions: vi.fn(),
  status: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock('../../platform.js', () => ({ isAndroid: () => true }));
vi.mock('./localSchedule.js', () => ({ localScheduler: mocks }));
vi.mock('@capacitor/app', () => ({
  App: {
    getState: async () => ({ isActive: true }),
    addListener: async (_name: string, callback: typeof mocks.app) => {
      mocks.app = callback;
      return { remove: mocks.remove };
    },
  },
}));
vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: async () => ({ connected: true }),
    addListener: async (_name: string, callback: typeof mocks.network) => {
      mocks.network = callback;
      return { remove: mocks.remove };
    },
  },
}));
const result = { complete: true, count: 2, total: 2, generatedAt: 1, validUntil: 100000, lastSuccessfulAt: 2 };
beforeEach(() => {
  vi.clearAllMocks();
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
  mocks.permissions.mockResolvedValue({ display: 'granted', exact: 'granted' });
  mocks.sync.mockResolvedValue(result);
  mocks.status.mockResolvedValue(result);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});
function View({ account }: { account: string }) {
  const { data } = useLocalSchedule(account);
  return (
    <>
      <ScheduleSync account={account} />
      <output>{JSON.stringify(data)}</output>
    </>
  );
}
function mount(account = 'family:one') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5000 } } });
  const element = (name: string) => (
    <QueryClientProvider client={client}>
      <View account={name} />
    </QueryClientProvider>
  );
  const view = render(element(account));
  return { client, ...view, change: (name: string) => view.rerender(element(name)) };
}
it('syncs at login, resumes and reconnects, and removes native listeners', async () => {
  const view = mount();
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('lastSuccessfulAt'));
  expect(mocks.sync).toHaveBeenCalledWith('family:one');
  const before = mocks.sync.mock.calls.length;
  act(() => {
    mocks.app?.({ isActive: false });
  });
  act(() => {
    mocks.app?.({ isActive: true });
  });
  await waitFor(() => expect(mocks.sync.mock.calls.length).toBeGreaterThan(before));
  const resumed = mocks.sync.mock.calls.length;
  act(() => {
    mocks.network?.({ connected: false });
  });
  act(() => {
    mocks.network?.({ connected: true });
  });
  await waitFor(() => expect(mocks.sync.mock.calls.length).toBeGreaterThan(resumed));
  view.unmount();
  expect(mocks.remove).toHaveBeenCalledTimes(2);
});
it('polls every 20 seconds only while the app is active', async () => {
  vi.useFakeTimers();
  mount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(mocks.sync).toHaveBeenCalled();
  await act(async () => {
    mocks.app?.({ isActive: true });
    await Promise.resolve();
  });
  const before = mocks.sync.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20000);
  });
  expect(mocks.sync.mock.calls.length).toBeGreaterThan(before);
  act(() => {
    mocks.app?.({ isActive: false });
  });
  const paused = mocks.sync.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(mocks.sync).toHaveBeenCalledTimes(paused);
});
it('invalidates after local edits and preserves the saved state with a visible transport error', async () => {
  const { client } = mount();
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('lastSuccessfulAt'));
  mocks.sync.mockRejectedValue(new Error('offline'));
  await act(async () => {
    await refreshLocalSchedule(client);
  });
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('offline'));
  expect(screen.getByRole('status').textContent).toContain('lastSuccessfulAt');
  expect(mocks.invalidate).toHaveBeenCalled();
});
it('does not expose a late result from the previous account', async () => {
  let finish!: (value: typeof result) => void;
  mocks.sync.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = mount();
  await waitFor(() => expect(mocks.sync).toHaveBeenCalled());
  view.change('family:two');
  await waitFor(() => expect(mocks.sync).toHaveBeenCalledWith('family:two'));
  await act(async () => {
    finish({ ...result, count: 999 });
  });
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('lastSuccessfulAt'));
  expect(screen.getByRole('status').textContent).not.toContain('999');
});

it('does not start an old account download after a delayed permission check', async () => {
  let finish!: (value: { display: string; exact: string }) => void;
  mocks.permissions.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = mount();
  await waitFor(() => expect(mocks.permissions).toHaveBeenCalled());
  view.change('family:two');
  await waitFor(() => expect(mocks.sync).toHaveBeenCalledWith('family:two'));
  await act(async () => {
    finish({ display: 'granted', exact: 'granted' });
  });
  expect(mocks.sync).not.toHaveBeenCalledWith('family:one');
});
