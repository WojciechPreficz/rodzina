import type { Task } from '@rodzina/shared';
import { checklistProgress } from './taskChecklistOffline.js';

export function confirmTaskCompletion(task: Task, isDone: boolean) {
  if (!isDone) return true;
  const progress = checklistProgress(task);
  if (!progress) return window.confirm('Nie znamy pełnej checklisty. Ukończyć zadanie bez sprawdzenia podzadań?');
  if (progress.done < progress.total)
    return window.confirm(
      `Pozostały niewykonane podzadania: ${progress.total - progress.done}. Ukończyć zadanie? Podzadania pozostaną bez zmian.`,
    );
  return true;
}
