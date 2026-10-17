import { registerPlugin } from '@capacitor/core';
import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications';
import { reminderScheduleSchema, type ReminderSchedule } from '@rodzina/shared';
import { apiFetch } from '../../api.js';
import { labels } from '../../i18n/pl.js';

const text = labels.localAlarms;
export const alarmStore = registerPlugin<{
  preview(): Promise<{ value: string | null }>;
  read(options: { account: string }): Promise<{ value: string | null; revision: string }>;
  write(options: { account: string; value: string; revision: string }): Promise<void>;
}>('RodzinaAlarms');
export const channelId = 'calendar-reminders-v1';
const spacing = 9 * 60_000;
export const alarmLimit = 400;
type Alarm = { key: string; id: number; fireAt: number; items: ReminderSchedule['reminders'] };
export type SavedSchedule = {
  snapshot: ReminderSchedule;
  ids: Record<string, number>;
  lastSuccessfulAt?: number | undefined;
};
export type ScheduleResult = {
  count: number;
  total: number;
  validUntil: number;
  generatedAt: number;
  complete: boolean;
  lastSuccessfulAt?: number | undefined;
};

export function hashAlarmKey(key: string) {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % 2147483647 || 1;
}

export function buildAlarms(snapshot: ReminderSchedule, ids: Record<string, number>, now: number, hash = hashAlarmKey) {
  const used = new Set(Object.values(ids));
  const alarms: Alarm[] = [];
  for (const item of [...snapshot.reminders].sort((a, b) => a.fireAt - b.fireAt || a.key.localeCompare(b.key))) {
    if (item.fireAt <= now) continue;
    let group = alarms.at(-1);
    if (!group || item.fireAt - group.fireAt >= spacing) {
      const key = item.key;
      let id = ids[key];
      if (!id) {
        id = hash(key);
        while (used.has(id)) id = id === 2147483647 ? 1 : id + 1;
        ids[key] = id;
        used.add(id);
      }
      group = { key, id, fireAt: item.fireAt, items: [] };
      alarms.push(group);
    }
    group.items.push(item);
  }
  return alarms;
}

function notification(alarm: Alarm): LocalNotificationSchema {
  const first = alarm.items[0]!;
  const body = alarm.items.map((item) => item.body).join('\n');
  return {
    id: alarm.id,
    title: alarm.items.length === 1 ? first.title : text.groupTitle(alarm.items.length),
    body,
    largeBody: body,
    channelId,
    smallIcon: 'ic_stat_reminder',
    isExactMandatory: true,
    schedule: { at: new Date(alarm.fireAt), allowWhileIdle: true },
    extra: { key: alarm.key, fingerprint: JSON.stringify(alarm), url: first.url, reminders: alarm.items },
  };
}

type Dependencies = {
  notifications: Pick<
    typeof LocalNotifications,
    | 'checkPermissions'
    | 'checkExactNotificationSetting'
    | 'listChannels'
    | 'createChannel'
    | 'getPending'
    | 'cancel'
    | 'schedule'
    | 'removeAllDeliveredNotifications'
  >;
  store: Pick<typeof alarmStore, 'read' | 'write'>;
  fetch: () => Promise<unknown>;
  now: () => number;
};

export function createLocalScheduler(deps: Dependencies) {
  let queue: Promise<unknown> = Promise.resolve();
  let generation = 0;
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const result = queue.then(work);
    queue = result.catch(() => undefined);
    return result;
  }
  async function saved(account: string): Promise<{ data: SavedSchedule | null; revision: string }> {
    const { value, revision } = await deps.store.read({ account });
    if (!value) return { data: null, revision };
    const data = JSON.parse(value) as SavedSchedule;
    const snapshot = reminderScheduleSchema.parse(data.snapshot);
    if (
      !data.ids ||
      (data.lastSuccessfulAt !== undefined &&
        (!Number.isSafeInteger(data.lastSuccessfulAt) || data.lastSuccessfulAt < 0)) ||
      Object.values(data.ids).some((id) => !Number.isInteger(id) || id < 1 || id > 2147483647) ||
      new Set(Object.values(data.ids)).size !== Object.values(data.ids).length
    )
      throw new Error(text.corrupt);
    return { data: { snapshot, ids: { ...data.ids }, lastSuccessfulAt: data.lastSuccessfulAt }, revision };
  }
  async function permissions() {
    const permission = await deps.notifications.checkPermissions();
    const exact = await deps.notifications.checkExactNotificationSetting();
    const channel = (await deps.notifications.listChannels()).channels.find((item) => item.id === channelId);
    return { display: channel?.importance === 0 ? 'denied' : permission.display, exact: exact.exact_alarm };
  }
  async function reconcile(
    account: string,
    data: SavedSchedule,
    requestGeneration: number,
    revision: string,
    downloaded = false,
  ): Promise<ScheduleResult> {
    const access = await permissions();
    if (access.display !== 'granted' || access.exact !== 'granted') throw new Error(text.permissionRequired);
    const all = buildAlarms(data.snapshot, data.ids, deps.now());
    const desired = all.slice(0, alarmLimit).map(notification);
    // Commit desired state and ID allocations before touching system alarms, so a crash is retryable.
    if (requestGeneration !== generation) throw new Error(text.sessionChanged);
    await deps.store.write({ account, value: JSON.stringify(data), revision });
    await deps.notifications.createChannel({
      id: channelId,
      name: text.channelName,
      importance: 4,
      visibility: 0,
      vibration: true,
    });
    const pending = (await deps.notifications.getPending()).notifications;
    const keep = new Map(desired.map((item) => [item.id, item]));
    const obsolete = pending.filter(
      (item) => !keep.has(item.id) || item.extra?.fingerprint !== keep.get(item.id)?.extra?.fingerprint,
    );
    if (obsolete.length) await deps.notifications.cancel({ notifications: obsolete.map(({ id }) => ({ id })) });
    const current = new Map(
      pending.filter((item) => !obsolete.some((old) => old.id === item.id)).map((item) => [item.id, item]),
    );
    let failed = false;
    for (const item of desired) {
      if (requestGeneration !== generation) throw new Error(text.sessionChanged);
      if (current.has(item.id)) continue;
      try {
        await deps.notifications.schedule({ notifications: [item] });
      } catch {
        failed = true;
      }
    }
    const actual = new Map((await deps.notifications.getPending()).notifications.map((item) => [item.id, item]));
    const confirmed = desired.filter((item) => actual.get(item.id)?.extra?.fingerprint === item.extra?.fingerprint);
    const missing = all.find((alarm) => !confirmed.some((item) => item.id === alarm.id));
    const after = await permissions();
    const complete =
      !failed &&
      !missing &&
      actual.size === desired.length &&
      after.display === 'granted' &&
      after.exact === 'granted' &&
      data.snapshot.validUntil > deps.now();
    if (requestGeneration !== generation) throw new Error(text.sessionChanged);
    if (complete && downloaded) {
      data.lastSuccessfulAt = deps.now();
      await deps.store.write({ account, value: JSON.stringify(data), revision });
    }
    return {
      count: confirmed.length,
      total: all.length,
      generatedAt: data.snapshot.generatedAt,
      validUntil: missing ? Math.min(data.snapshot.validUntil, missing.fireAt - 1) : data.snapshot.validUntil,
      complete,
      lastSuccessfulAt: data.lastSuccessfulAt,
    };
  }
  return {
    permissions,
    invalidate() {
      generation += 1;
    },
    status(account: string) {
      const requestGeneration = generation;
      return serial(async (): Promise<ScheduleResult | undefined> => {
        if (requestGeneration !== generation) throw new Error(text.sessionChanged);
        const { data } = await saved(account);
        if (!data) return undefined;
        const access = await permissions();
        const desired = buildAlarms(data.snapshot, data.ids, deps.now());
        const actual = new Map((await deps.notifications.getPending()).notifications.map((item) => [item.id, item]));
        const confirmed = desired.filter(
          (alarm) => actual.get(alarm.id)?.extra?.fingerprint === notification(alarm).extra?.fingerprint,
        );
        const missing = desired.find((alarm) => !confirmed.includes(alarm));
        return {
          count: confirmed.length,
          total: desired.length,
          generatedAt: data.snapshot.generatedAt,
          validUntil: missing ? Math.min(data.snapshot.validUntil, missing.fireAt - 1) : data.snapshot.validUntil,
          lastSuccessfulAt: data.lastSuccessfulAt,
          complete:
            !missing &&
            actual.size === desired.length &&
            access.display === 'granted' &&
            access.exact === 'granted' &&
            data.snapshot.validUntil > deps.now(),
        };
      });
    },
    sync(account: string) {
      const requestGeneration = generation;
      return serial(async () => {
        if (requestGeneration !== generation) throw new Error(text.sessionChanged);
        const snapshot = reminderScheduleSchema.parse(await deps.fetch());
        if (requestGeneration !== generation) throw new Error(text.sessionChanged);
        if (
          snapshot.validUntil <= deps.now() ||
          snapshot.generatedAt > snapshot.validUntil ||
          new Set(snapshot.reminders.map((item) => item.key)).size !== snapshot.reminders.length ||
          snapshot.reminders.some((item) => item.fireAt <= snapshot.generatedAt || item.fireAt > snapshot.validUntil)
        )
          throw new Error(text.invalidSnapshot);
        const old = await saved(account);
        if (old.data && old.data.snapshot.generatedAt > snapshot.generatedAt) throw new Error(text.invalidSnapshot);
        return reconcile(
          account,
          { snapshot, ids: old.data?.ids ?? {}, lastSuccessfulAt: old.data?.lastSuccessfulAt },
          requestGeneration,
          old.revision,
          true,
        );
      });
    },
    retry(account: string) {
      const requestGeneration = generation;
      return serial(async () => {
        if (requestGeneration !== generation) throw new Error(text.sessionChanged);
        const data = await saved(account);
        if (!data.data) throw new Error(text.empty);
        return reconcile(account, data.data, requestGeneration, data.revision);
      });
    },
    clear() {
      generation += 1;
      return serial(async () => {
        const { notifications } = await deps.notifications.getPending();
        if (notifications.length)
          await deps.notifications.cancel({ notifications: notifications.map(({ id }) => ({ id })) });
        await deps.notifications.removeAllDeliveredNotifications();
      });
    },
  };
}

export const localScheduler = createLocalScheduler({
  notifications: LocalNotifications,
  store: alarmStore,
  fetch: () => apiFetch('/api/reminders/schedule'),
  now: Date.now,
});
