import type { CalendarEvent, EventData, EventPatch, EventScope, occurrencesResponseSchema } from '@rodzina/shared';
import type { z } from 'zod';
import { apiFetch } from '../../api.js';

export type CalendarOccurrence = z.infer<typeof occurrencesResponseSchema>['occurrences'][number];
export type CalendarRange = { from: string; to: string };

function scopeQuery(scope: EventScope): URLSearchParams {
  const query = new URLSearchParams({ scope: scope.scope });
  if (scope.occurrenceDate) query.set('occurrenceDate', scope.occurrenceDate);
  return query;
}

export async function listOccurrences(range: CalendarRange): Promise<CalendarOccurrence[]> {
  const response = await apiFetch<{ occurrences: CalendarOccurrence[] }>(
    `/api/occurrences?${new URLSearchParams(range)}`,
  );
  return response.occurrences;
}

export async function getEvent(id: string): Promise<CalendarEvent> {
  return (await apiFetch<{ event: CalendarEvent }>(`/api/events/${encodeURIComponent(id)}`)).event;
}

export async function createEvent(data: EventData): Promise<CalendarEvent> {
  return (await apiFetch<{ event: CalendarEvent }>('/api/events', { method: 'POST', body: JSON.stringify(data) }))
    .event;
}

export async function listDistantEvents(): Promise<CalendarEvent[]> {
  return (await apiFetch<{ events: CalendarEvent[] }>('/api/events/upcoming-distant')).events;
}

export async function updateEvent(
  id: string,
  data: EventPatch,
  scope: EventScope = { scope: 'all' },
): Promise<CalendarEvent> {
  return (
    await apiFetch<{ event: CalendarEvent }>(`/api/events/${encodeURIComponent(id)}?${scopeQuery(scope)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  ).event;
}

export async function deleteEvent({ id, scope = { scope: 'all' } }: { id: string; scope?: EventScope }): Promise<void> {
  await apiFetch(`/api/events/${encodeURIComponent(id)}?${scopeQuery(scope)}`, { method: 'DELETE' });
}
