import { useCallback, useState } from 'react';
import type { NavigateFunction, SetURLSearchParams } from 'react-router';
import type { CreateTask, PatchTask, PatchTaskList, Task, TaskChecklistItem } from '@rodzina/shared';
import { labels } from '../../i18n/pl.js';
import { allowNavigation } from '../../nativeNavigation.js';
import type { ChecklistChange } from './TaskChecklist.js';
import { confirmTaskCompletion } from './taskCompletion.js';
import type { useTasks } from './taskQueries.js';

const t = labels.tasksUi;

export function useTaskActions(
  data: ReturnType<typeof useTasks>,
  navigate: NavigateFunction,
  setParams: SetURLSearchParams,
) {
  const [addingList, setAddingList] = useState(false);
  const [listName, setListName] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [settingsOpened, setSettingsOpened] = useState(false);
  const [clearingDone, setClearingDone] = useState(false);
  const [actionError, setActionError] = useState<string>();

  const resetForList = useCallback(() => {
    setAddingTask(false);
    setSettingsOpened(false);
    setClearingDone(false);
    setActionError(undefined);
  }, []);

  const run = async (action: () => Promise<unknown>) => {
    setActionError(undefined);
    try {
      await action();
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t.failed);
      return false;
    }
  };

  const closeTask = () => {
    if (data.checklist.isPending) return;
    if (!allowNavigation()) return;
    setAddingTask(false);
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('zadanie');
      return next;
    });
  };

  return {
    actionError,
    dismissError: () => setActionError(undefined),
    resetForList,
    addingList,
    listName,
    setListName,
    openAddList: () => {
      data.createList.reset();
      setAddingList(true);
    },
    closeAddList: () => setAddingList(false),
    createList: () => {
      if (!listName.trim() || data.createList.isPending) return;
      void run(async () => {
        const list = await data.createList.mutateAsync({ name: listName.trim() });
        setAddingList(false);
        setListName('');
        void navigate(`/zadania/${list.id}`);
      });
    },
    settingsOpened,
    openSettings: () => {
      data.updateList.reset();
      data.removeList.reset();
      setSettingsOpened(true);
    },
    closeSettings: () => {
      if (allowNavigation()) setSettingsOpened(false);
    },
    saveList: async (input: PatchTaskList) => {
      await data.updateList.mutateAsync(input);
    },
    deleteList: async () => {
      await data.removeList.mutateAsync();
      void navigate('/zadania');
    },
    leaveList: () => {
      if (window.confirm(t.leaveListConfirm))
        void run(async () => {
          await data.leaveList.mutateAsync();
          void navigate('/zadania');
        });
    },
    addingTask,
    openAddTask: () => {
      data.create.reset();
      setAddingTask(true);
    },
    closeTask,
    quickAdd: (title: string) => run(() => data.create.mutateAsync({ title })),
    resetTaskUpdate: () => data.update.reset(),
    toggleDone: (task: Task, isDone: boolean) => {
      if (!confirmTaskCompletion(task, isDone)) return;
      void run(() => data.update.mutateAsync({ id: task.id, data: { isDone } }));
    },
    toggleChecklistItem: (taskId: string, item: TaskChecklistItem, isDone: boolean) => {
      void run(() =>
        data.checklist.mutateAsync({
          id: taskId,
          change: {
            type: 'checklist-update',
            itemId: item.id,
            data: { isDone, doneVersion: item.doneVersion },
          },
        }),
      );
    },
    changeChecklist: (id: string, change: Parameters<ChecklistChange>[0]) => data.checklist.mutateAsync({ id, change }),
    saveTask: async (input: CreateTask, id?: string, changes?: PatchTask) => {
      if (id) return data.update.mutateAsync({ id, data: changes ?? input });
      return data.create.mutateAsync(input);
    },
    deleteTask: (id: string) => {
      if (window.confirm(t.deleteConfirm))
        void run(async () => {
          await data.remove.mutateAsync(id);
          closeTask();
        });
    },
    clearingDone,
    openClearDone: () => {
      data.clearDone.reset();
      setClearingDone(true);
    },
    closeClearDone: () => {
      if (!data.clearDone.isPending) setClearingDone(false);
    },
    clearDone: () => {
      void run(async () => {
        await data.clearDone.mutateAsync();
        setClearingDone(false);
      });
    },
  };
}
