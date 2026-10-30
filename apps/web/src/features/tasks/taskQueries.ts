import { useEffect, useSyncExternalStore } from 'react';
import { focusManager, onlineManager, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateTask, CreateTaskList, PatchTask, PatchTaskList, Task, TaskList } from '@rodzina/shared';
import { apiFetch } from '../../api.js';
import { useMe } from '../../sessionContext.js';
import { isOffline, useOffline } from '../../connectivity.js';
import { SYNC_INTERVAL_MS } from '../../queryClient.js';
import { refreshLocalSchedule } from '../notifications/scheduleSync.js';
import { TASK_SIGNAL } from './taskStorage.js';
import { useOfflineSyncStatus } from '../../offline/status.js';
import { offlineTaskPatch, taskOfflineText, taskOperationBlocksAlarm, taskStore } from './taskOffline.js';

export function useTaskData() {
  const { user, family } = useMe();
  const offline = useOffline();
  const state = useSyncExternalStore(taskStore.subscribe, taskStore.getSnapshot);
  const account = user && family ? `${family.id}:${user.id}` : '';
  return {
    ...(state.account === account
      ? taskStore.project()
      : {
          items: {} as Record<string, Task[]>,
          lists: undefined,
          pending: [],
          error: undefined,
          syncing: false,
          syncedAt: undefined,
        }),
    offline,
  };
}

export function TaskPrefetch() {
  const { user, family, familyConfirmed } = useMe();
  const account = user && family ? family.id + ':' + user.id : '';
  useEffect(() => {
    if (!account) return;
    let disposed = false;
    const ready = taskStore.activate(account);
    const sync = () => {
      if (onlineManager.isOnline() && focusManager.isFocused())
        void ready.then(() => {
          if (!disposed && taskStore.getSnapshot().account === account) return taskStore.synchronize();
        });
    };
    if (familyConfirmed) sync();
    const stopOnline = onlineManager.subscribe((online) => {
      if (online) sync();
    });
    const stopFocus = focusManager.subscribe((focused) => {
      if (focused) sync();
    });
    const storage = (event: StorageEvent) => {
      if (event.key === TASK_SIGNAL) {
        void taskStore.reload();
      }
    };
    window.addEventListener('storage', storage);
    const interval = window.setInterval(sync, SYNC_INTERVAL_MS);
    return () => {
      disposed = true;
      stopOnline();
      stopFocus();
      window.removeEventListener('storage', storage);
      window.clearInterval(interval);
    };
  }, [account, familyConfirmed]);
  return null;
}

export function useTasks(listId?: string) {
  const { user, family, familyConfirmed } = useMe();
  const data = useTaskData();
  const status = useOfflineSyncStatus(user && family ? `${family.id}:${user.id}` : '', 'tasks');
  const client = useQueryClient();
  const key = ['tasks', family?.id, user?.id];
  const active = data.lists?.find((list) => list.id === listId);
  const items = listId ? data.items[listId] : undefined;
  const refetch = async () => {
    await taskStore.synchronize();
  };
  const query = <T>(value: T | undefined) => ({
    data: value,
    isError: false,
    error: null as Error | null,
    isFetchedAfterMount: value !== undefined,
    isPending: value === undefined,
    refetch,
  });
  const sync = async () => {
    await taskStore.synchronize();
    await Promise.all([client.invalidateQueries({ queryKey: key }), refreshLocalSchedule(client)]);
  };
  const write = async <T>(path: string, method: string, body: unknown): Promise<T> => {
    if (!familyConfirmed || isOffline()) throw new Error(taskOfflineText.limits);
    return apiFetch<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  };
  const mutationOptions = { networkMode: 'always' as const, retry: false, onSuccess: sync };
  const createList = useMutation({
    ...mutationOptions,
    mutationFn: async (input: CreateTaskList) =>
      (await write<{ list: TaskList }>('/api/tasks/lists', 'POST', input)).list,
  });
  const updateList = useMutation({
    ...mutationOptions,
    mutationFn: (input: PatchTaskList) => write(`/api/tasks/lists/${encodeURIComponent(listId!)}`, 'PATCH', input),
  });
  const removeList = useMutation({
    ...mutationOptions,
    mutationFn: () => write(`/api/tasks/lists/${encodeURIComponent(listId!)}`, 'DELETE', undefined),
  });
  const leaveList = useMutation({
    ...mutationOptions,
    mutationFn: () => write(`/api/tasks/lists/${encodeURIComponent(listId!)}/leave`, 'POST', undefined),
  });
  const submitChanges = async (changes: { id: string; change: Parameters<typeof taskStore.enqueue>[2] }[]) => {
    try {
      for (const { id, change } of changes) await taskStore.enqueue(listId!, id, change);
    } finally {
      window.dispatchEvent(new Event('rodzina:tasks-changed'));
    }
    const pending = () => taskStore.getSnapshot().pending.some((op) => changes.some(({ id }) => op.taskId === id));
    if (!isOffline()) {
      await taskStore.synchronize();
      if (!taskStore.getSnapshot().error && pending()) await taskStore.synchronize();
      window.dispatchEvent(new Event('rodzina:tasks-changed'));
      if (taskStore.getSnapshot().error && !pending()) throw new Error(taskStore.getSnapshot().error);
      if (
        taskStore
          .getSnapshot()
          .pending.some((op) => op.status === 'needs-review' && changes.some(({ id }) => op.taskId === id))
      )
        throw new Error(taskStore.getSnapshot().error ?? taskOfflineText.blocked);
    }
  };
  const submit = async (id: string, change: Parameters<typeof taskStore.enqueue>[2]) => {
    await submitChanges([{ id, change }]);
    return taskStore.project().items[listId!]?.find((task) => task.id === id);
  };
  const create = useMutation({
    networkMode: 'always',
    mutationFn: async (input: CreateTask) => {
      const fields = isOffline() ? (offlineTaskPatch(input) as CreateTask) : input;
      return (await submit(crypto.randomUUID(), { type: 'create', data: fields }))!;
    },
  });
  const update = useMutation({
    networkMode: 'always',
    mutationFn: async ({ id, data: input }: { id: string; data: PatchTask }) => {
      const original = taskStore.project().items[listId!]?.find((task) => task.id === id);
      const changed = Object.fromEntries(
        Object.entries(input).filter(
          ([field, value]) => JSON.stringify(original?.[field as keyof Task]) !== JSON.stringify(value),
        ),
      ) as PatchTask;
      const fields = isOffline() ? offlineTaskPatch(changed, original) : changed;
      if (!Object.keys(fields).length) return original!;
      return (await submit(id, { type: 'update', data: fields }))!;
    },
  });
  const remove = useMutation({
    networkMode: 'always',
    mutationFn: async (id: string) => {
      await submit(id, { type: 'remove' });
    },
  });
  const clearDone = useMutation({
    networkMode: 'always',
    mutationFn: async () => {
      const completed = taskStore.project().items[listId!]?.filter((task) => task.isDone) ?? [];
      await submitChanges(completed.map((task) => ({ id: task.id, change: { type: 'remove' } })));
    },
  });
  const checklist = useMutation({
    networkMode: 'always',
    mutationFn: ({ id, change }: { id: string; change: Parameters<typeof taskStore.enqueue>[2] }) => submit(id, change),
  });
  return {
    checklist,
    lists: query(data.lists),
    tasks: query(items),
    active,
    enabled: !!user && !!family,
    offline: data.offline,
    syncedAt: data.syncedAt,
    pendingCount: data.pending.filter((op) => op.status === 'pending').length,
    reviewOperations: data.pending.filter((op) => op.status === 'needs-review'),
    reviewItems: data.items,
    discardReview: async (operationIds: string[]) => {
      await taskStore.discardReview(operationIds);
      if (!isOffline()) await sync();
    },
    pendingAlarms: data.pending.some(taskOperationBlocksAlarm),
    syncError: data.error ?? status.lastError ?? status.storageIssue,
    syncing: data.syncing || status.syncing,
    createList,
    updateList,
    removeList,
    leaveList,
    create,
    update,
    remove,
    clearDone,
  };
}
