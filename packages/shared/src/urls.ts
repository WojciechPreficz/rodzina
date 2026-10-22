export function eventUrl(eventId: string, occurrenceDate?: string): string {
  const path = `/kalendarz/wydarzenie/${encodeURIComponent(eventId)}`;
  return occurrenceDate ? `${path}?data=${encodeURIComponent(occurrenceDate)}` : path;
}
export function taskUrl(listId: string, taskId: string): string {
  return `/zadania/${encodeURIComponent(listId)}?zadanie=${encodeURIComponent(taskId)}`;
}
export function documentUrl(documentId: string): string {
  return `/dokumenty/${encodeURIComponent(documentId)}`;
}
