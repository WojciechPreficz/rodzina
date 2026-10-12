export function eventUrl(eventId: string, occurrenceDate?: string): string {
  const path = `/kalendarz/wydarzenie/${encodeURIComponent(eventId)}`;
  return occurrenceDate ? `${path}?data=${encodeURIComponent(occurrenceDate)}` : path;
}
