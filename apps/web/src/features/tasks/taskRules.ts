import { localDateTimeToUtc, type Task } from '@rodzina/shared';

export function isTaskOverdue(task: Task, timezone: string, now = Date.now()) {
  if (task.isDone || !task.dueDate) return false;
  if (task.dueTime) return localDateTimeToUtc(task.dueDate, task.dueTime, timezone) < now;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
  return task.dueDate < today;
}
