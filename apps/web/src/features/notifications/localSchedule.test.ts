import { expect, it, vi } from 'vitest';
import type { LocalNotificationSchema } from '@capacitor/local-notifications';
import type { ReminderSchedule, ScheduledReminder } from '@rodzina/shared';
import { alarmLimit, buildAlarms, createLocalScheduler } from './localSchedule.js';

const now = Date.UTC(2026, 9, 16, 12);
function reminder(key: string, fireAt = now + 60_000): ScheduledReminder {
  return {
    key,
    reminderId: '10000000-0000-4000-8000-000000000001',
    sourceId: '10000000-0000-4000-8000-000000000002',
    sourceType: 'event',
    occurrenceDate: '2026-10-16',
    fireAt,
    title: 'Basen',
    body: '16.10.2026 15:00: Basen',
    url: '/kalendarz/wydarzenie/10000000-0000-4000-8000-000000000002?data=2026-10-16',
  };
}
function fixture(items = [reminder('one')]) {
  let value: string | null = null;
  const pending = new Map<number, LocalNotificationSchema>();
  const snapshot: ReminderSchedule = { ok: true, generatedAt: now, validUntil: now + 90 * 86400_000, reminders: items };
  const notifications = {
    listChannels: vi.fn(async () => ({ channels: [] })),
    checkPermissions: vi.fn(async () => ({ display: 'granted' as const })),
    checkExactNotificationSetting: vi.fn(async () => ({ exact_alarm: 'granted' as const })),
    createChannel: vi.fn(async () => undefined),
    getPending: vi.fn(async () => ({ notifications: [...pending.values()] })),
    cancel: vi.fn(async ({ notifications }: { notifications: { id: number }[] }) => {
      notifications.forEach(({ id }) => pending.delete(id));
    }),
    schedule: vi.fn(async ({ notifications }: { notifications: LocalNotificationSchema[] }) => {
      notifications.forEach((item) => pending.set(item.id, item));
      return { notifications: notifications.map(({ id }) => ({ id })) };
    }),
    removeAllDeliveredNotifications: vi.fn(async () => undefined),
  };
  const store = {
    read: vi.fn(async () => ({ value, revision: 'one' })),
    write: vi.fn(async (options: { value: string }) => {
      value = options.value;
    }),
  };
  const fetch = vi.fn(async (): Promise<unknown> => snapshot);
  const scheduler = createLocalScheduler({ notifications, store, fetch, now: () => now });
  return { scheduler, notifications, store, fetch, pending, snapshot };
}

it('allocates stable positive IDs and resolves hash collisions including wraparound', () => {
  const ids = {};
  const snapshot = fixture([reminder('one'), reminder('two', now + 20 * 60_000)]).snapshot;
  const alarms = buildAlarms(snapshot, ids, now, () => 2147483647);
  expect(alarms.map((item) => item.id)).toEqual([2147483647, 1]);
  expect(buildAlarms(snapshot, ids, now, () => 2147483647)).toEqual(alarms);
});
it('groups nearby alarms at the earliest UTC instant and preserves every reminder', async () => {
  const f = fixture([reminder('one'), reminder('two', now + 5 * 60_000), reminder('three', now + 10 * 60_000)]);
  const result = await f.scheduler.sync('family:user');
  expect(result).toMatchObject({ complete: true, count: 2, total: 2 });
  const first = [...f.pending.values()][0]!;
  expect(first.extra.reminders).toHaveLength(2);
  expect(first.schedule).toMatchObject({ at: new Date(now + 60_000), allowWhileIdle: true });
  expect(first.isExactMandatory).toBe(true);
});
it('repeated reads and a new JS process do not duplicate persisted alarms', async () => {
  const f = fixture();
  await f.scheduler.sync('family:user');
  await f.scheduler.sync('family:user');
  const restarted = createLocalScheduler({
    notifications: f.notifications,
    store: f.store,
    fetch: f.fetch,
    now: () => now,
  });
  await restarted.retry('family:user');
  expect(f.notifications.schedule).toHaveBeenCalledTimes(1);
  expect(f.pending.size).toBe(1);
});
it('updates content and time under the same ID and removes missing alarms', async () => {
  const f = fixture();
  await f.scheduler.sync('family:user');
  const id = [...f.pending.keys()][0];
  f.snapshot.reminders[0] = { ...reminder('one', now + 3600_000), body: 'Nowy termin' };
  await f.scheduler.sync('family:user');
  expect([...f.pending.keys()]).toEqual([id]);
  expect(f.pending.get(id!)?.body).toBe('Nowy termin');
  f.snapshot.reminders = [];
  await f.scheduler.sync('family:user');
  expect(f.pending.size).toBe(0);
});
it('reconciles a partially scheduled batch and retries only missing alarms', async () => {
  const f = fixture([reminder('one'), reminder('two', now + 3600_000)]);
  f.notifications.schedule.mockRejectedValueOnce(new Error('device full'));
  expect(await f.scheduler.sync('family:user')).toMatchObject({
    complete: false,
    count: 1,
    total: 2,
    validUntil: now + 60_000 - 1,
  });
  expect(await f.scheduler.retry('family:user')).toMatchObject({ complete: true, count: 2 });
  expect(f.notifications.schedule).toHaveBeenCalledTimes(3);
});
it('verifies actual stored alarms even when schedule returns success', async () => {
  const f = fixture();
  f.notifications.schedule.mockResolvedValueOnce({ notifications: [] });
  expect(await f.scheduler.sync('family:user')).toMatchObject({ complete: false, count: 0 });
  expect(await f.scheduler.retry('family:user')).toMatchObject({ complete: true, count: 1 });
});
it('network errors, invalid partial snapshots and old snapshots preserve existing alarms', async () => {
  const f = fixture();
  await f.scheduler.sync('family:user');
  f.fetch.mockRejectedValueOnce(new Error('offline'));
  await expect(f.scheduler.sync('family:user')).rejects.toThrow('offline');
  f.fetch.mockResolvedValueOnce({ reminders: [] });
  await expect(f.scheduler.sync('family:user')).rejects.toThrow();
  f.fetch.mockResolvedValueOnce({ ...f.snapshot, generatedAt: now - 1, reminders: [] });
  await expect(f.scheduler.sync('family:user')).rejects.toThrow();
  expect(f.pending.size).toBe(1);
  expect(f.notifications.cancel).not.toHaveBeenCalled();
});
it.each(['display', 'exact'])('does not schedule or claim success without %s permission', async (permission) => {
  const f = fixture();
  if (permission === 'display') f.notifications.checkPermissions.mockResolvedValue({ display: 'denied' } as never);
  else f.notifications.checkExactNotificationSetting.mockResolvedValue({ exact_alarm: 'denied' } as never);
  await expect(f.scheduler.sync('family:user')).rejects.toThrow('Zezwól');
  expect(f.notifications.schedule).not.toHaveBeenCalled();
  expect(f.store.write).not.toHaveBeenCalled();
});
it('reports the device cap and the actual protection horizon without silently dropping alarms', async () => {
  const f = fixture(
    Array.from({ length: alarmLimit + 1 }, (_, index) => reminder(`key-${index}`, now + (index + 1) * 600_000)),
  );
  const result = await f.scheduler.sync('family:user');
  expect(result).toMatchObject({
    complete: false,
    count: alarmLimit,
    total: alarmLimit + 1,
    validUntil: now + (alarmLimit + 1) * 600_000 - 1,
  });
});
it('serializes operations and clears pending and visible notifications on logout', async () => {
  const f = fixture();
  await f.scheduler.sync('family:user');
  await f.scheduler.clear();
  expect(f.pending.size).toBe(0);
  expect(f.notifications.removeAllDeliveredNotifications).toHaveBeenCalledOnce();
});
it('rejects a download interrupted by logout before planning', async () => {
  const f = fixture();
  let finish!: (value: unknown) => void;
  f.fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const sync = f.scheduler.sync('family:user');
  await vi.waitFor(() => expect(f.fetch).toHaveBeenCalled());
  const rejected = expect(sync).rejects.toThrow('Konto');
  const clear = f.scheduler.clear();
  finish(f.snapshot);
  await rejected;
  await clear;
  expect(f.notifications.schedule).not.toHaveBeenCalled();
});
