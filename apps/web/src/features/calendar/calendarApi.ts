import type { CalendarEvent, EventData, EventPatch, occurrencesResponseSchema } from '@rodzina/shared';
import type { z } from 'zod';
import { apiFetch } from '../../api.js';

export type CalendarOccurrence = z.infer<typeof occurrencesResponseSchema>['occurrences'][number];
export type CalendarRange = { from: string; to: string };

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

export async function updateEvent(id: string, data: EventPatch): Promise<CalendarEvent> {
  return (
    await apiFetch<{ event: CalendarEvent }>(`/api/events/${encodeURIComponent(id)}?scope=all`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  ).event;
}

export async function deleteEvent(id: string): Promise<void> {
  await apiFetch(`/api/events/${encodeURIComponent(id)}?scope=all`, { method: 'DELETE' });
}
