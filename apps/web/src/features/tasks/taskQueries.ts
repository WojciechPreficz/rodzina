import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateTask, CreateTaskList, PatchTask, PatchTaskList, Task, TaskList } from '@rodzina/shared';
import { apiFetch } from '../../api.js';
import { useMe } from '../../auth.js';
import { isOffline, useOffline } from '../../connectivity.js';
import { SYNC_INTERVAL_MS } from '../../queryClient.js';
import { refreshLocalSchedule } from '../notifications/scheduleSync.js';

export function useTasks(listId?: string) {
  const { user, family, familyConfirmed } = useMe();
  const offline = useOffline();
  const client = useQueryClient();
  const key = ['tasks', family?.id, user?.id];
  const enabled = !!user && !!family && familyConfirmed && !offline;
  const refresh = {
    staleTime: 0,
    retry: false,
    refetchInterval: SYNC_INTERVAL_MS,
    refetchOnMount: 'always' as const,
    refetchOnWindowFocus: 'always' as const,
    refetchOnReconnect: 'always' as const,
  };
  const lists = useQuery({
    queryKey: [...key, 'lists'],
    queryFn: async ({ signal }) => (await apiFetch<{ lists: TaskList[] }>('/api/tasks/lists', { signal })).lists,
    enabled,
    ...refresh,
  });
  const active = lists.data?.find((list) => list.id === listId);
  const tasks = useQuery({
    queryKey: [...key, 'items', listId],
    queryFn: async ({ signal }) =>
      (
        await apiFetch<{ tasks: Task[] }>(`/api/tasks/lists/${encodeURIComponent(listId!)}/tasks?status=all`, {
          signal,
        })
      ).tasks,
    enabled: enabled && !!active && !lists.isError && lists.isFetchedAfterMount,
    ...refresh,
  });
  const sync = async () => {
    await Promise.all([client.invalidateQueries({ queryKey: key }), refreshLocalSchedule(client)]);
  };
  const write = async <T>(path: string, method: string, data: unknown): Promise<T> => {
    if (!enabled || isOffline()) throw new Error('Połącz się z internetem, aby zmienić zadania.');
    return apiFetch<T>(path, { method, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  };
  const mutationOptions = { networkMode: 'always' as const, retry: false, onSuccess: sync };
  const createList = useMutation({
    ...mutationOptions,
    mutationFn: async (data: CreateTaskList) =>
      (await write<{ list: TaskList }>('/api/tasks/lists', 'POST', data)).list,
  });
  const updateList = useMutation({
    ...mutationOptions,
    mutationFn: (data: PatchTaskList) => write(`/api/tasks/lists/${encodeURIComponent(listId!)}`, 'PATCH', data),
  });
  const removeList = useMutation({
    ...mutationOptions,
    mutationFn: () => write(`/api/tasks/lists/${encodeURIComponent(listId!)}`, 'DELETE', undefined),
  });
  const leaveList = useMutation({
    ...mutationOptions,
    mutationFn: () => write(`/api/tasks/lists/${encodeURIComponent(listId!)}/leave`, 'POST', undefined),
  });
  const create = useMutation({
    ...mutationOptions,
    mutationFn: async (data: CreateTask) =>
      (await write<{ task: Task }>(`/api/tasks/lists/${encodeURIComponent(listId!)}/tasks`, 'POST', data)).task,
  });
  const update = useMutation({
    ...mutationOptions,
    mutationFn: async ({ id, data }: { id: string; data: PatchTask }) =>
      (await write<{ task: Task }>(`/api/tasks/${encodeURIComponent(id)}`, 'PATCH', data)).task,
  });
  const remove = useMutation({
    ...mutationOptions,
    mutationFn: (id: string) => write(`/api/tasks/${encodeURIComponent(id)}`, 'DELETE', undefined),
  });
  return {
    lists,
    tasks,
    active,
    enabled,
    offline,
    createList,
    updateList,
    removeList,
    leaveList,
    create,
    update,
    remove,
  };
}
