import { useEffect, useSyncExternalStore } from 'react';
import { focusManager, onlineManager, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateTask, CreateTaskList, PatchTask, PatchTaskList, Task, TaskList } from '@rodzina/shared';
import { apiFetch } from '../../api.js';
import { useMe } from '../../auth.js';
import { isOffline, useOffline } from '../../connectivity.js';
import { SYNC_INTERVAL_MS } from '../../queryClient.js';
import { refreshLocalSchedule } from '../notifications/scheduleSync.js';
import { offlineTaskPatch, taskOfflineText, taskStore } from './taskOffline.js';

export function useTaskData() {
  const { user, family, familyConfirmed } = useMe();
  const offline = useOffline();
  const state = useSyncExternalStore(taskStore.subscribe, taskStore.getSnapshot);
  const account = user && family ? `${family.id}:${user.id}` : '';
  useEffect(() => {
    if (!account) return;
    taskStore.activate(account);
    const sync = () => {
      if (onlineManager.isOnline() && focusManager.isFocused()) void taskStore.synchronize();
    };
    if (familyConfirmed) sync();
    const stopOnline = onlineManager.subscribe((online) => {
      if (online) sync();
    });
    const stopFocus = focusManager.subscribe((focused) => {
      if (focused) sync();
    });
    const storage = (event: StorageEvent) => {
      if (event.key?.startsWith('rodzina:tasks:')) {
        taskStore.reload();
        sync();
      }
    };
    window.addEventListener('storage', storage);
    const interval = window.setInterval(sync, SYNC_INTERVAL_MS);
    return () => {
      stopOnline();
      stopFocus();
      window.removeEventListener('storage', storage);
      window.clearInterval(interval);
    };
  }, [account, familyConfirmed]);
  return {
    ...(state.account === account
      ? taskStore.project()
      : { items: {} as Record<string, Task[]>, lists: undefined, pending: [], error: undefined, syncing: false }),
    offline,
  };
}

export function TaskPrefetch() {
  useTaskData();
  return null;
}

export function useTasks(listId?: string) {
  const { user, family, familyConfirmed } = useMe();
  const data = useTaskData();
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
  const submit = async (id: string, change: Parameters<typeof taskStore.enqueue>[2]) => {
    const result = taskStore.enqueue(listId!, id, change);
    window.dispatchEvent(new Event('rodzina:tasks-changed'));
    if (!isOffline()) {
      await taskStore.synchronize();
      if (!taskStore.getSnapshot().error && taskStore.getSnapshot().pending.some((op) => op.taskId === id))
        await taskStore.synchronize();
      window.dispatchEvent(new Event('rodzina:tasks-changed'));
      if (taskStore.getSnapshot().error && !taskStore.getSnapshot().pending.some((op) => op.taskId === id))
        throw new Error(taskStore.getSnapshot().error);
    }
    return taskStore.project().items[listId!]?.find((task) => task.id === id) ?? result;
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
  return {
    lists: query(data.lists),
    tasks: query(items),
    active,
    enabled: !!user && !!family,
    offline: data.offline,
    pendingCount: data.pending.length,
    pendingAlarms: data.pending.some(
      (op) =>
        op.change.type === 'remove' ||
        (op.change.type === 'update' &&
          (op.change.data.isDone !== undefined ||
            op.change.data.dueDate !== undefined ||
            op.change.data.dueTime !== undefined)),
    ),
    syncError: data.error,
    syncing: data.syncing,
    createList,
    updateList,
    removeList,
    leaveList,
    create,
    update,
    remove,
  };
}
