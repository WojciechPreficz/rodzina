import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EventPatch, EventScope } from '@rodzina/shared';
import { useMe } from '../../auth.js';
import { ApiRequestError } from '../../api.js';
import { SYNC_INTERVAL_MS } from '../../queryClient.js';
import {
  createEvent,
  deleteEvent,
  getEvent,
  listDistantEvents,
  listOccurrences,
  updateEvent,
  type CalendarRange,
} from './calendarApi.js';

export function useDistantEvents() {
  const { family } = useMe();
  return useQuery({
    queryKey: ['calendar', family?.id, 'distant'],
    queryFn: listDistantEvents,
    refetchInterval: SYNC_INTERVAL_MS,
    refetchOnWindowFocus: 'always',
  });
}

export function useOccurrences(range: CalendarRange) {
  const { family } = useMe();
  return useQuery({
    queryKey: ['calendar', family?.id, 'occurrences', range],
    queryFn: () => listOccurrences(range),
    refetchInterval: SYNC_INTERVAL_MS,
    refetchOnWindowFocus: 'always',
  });
}

export function useEvent(id: string) {
  const { family, user } = useMe();
  return useQuery({
    queryKey: ['calendar', family?.id, user?.id, 'event', id],
    queryFn: () => getEvent(id),
    refetchInterval: SYNC_INTERVAL_MS,
    refetchOnWindowFocus: 'always',
    retry: (count, error) => !(error instanceof ApiRequestError && error.status === 404) && count < 1,
  });
}

export function useCalendarMutations() {
  const client = useQueryClient();
  const sync = async () => {
    await client.invalidateQueries({ queryKey: ['calendar'] });
  };
  const create = useMutation({ mutationFn: createEvent, onSuccess: sync });
  const update = useMutation({
    mutationFn: ({ id, data, scope }: { id: string; data: EventPatch; scope?: EventScope }) =>
      updateEvent(id, data, scope),
    onSuccess: sync,
  });
  const remove = useMutation({ mutationFn: deleteEvent, onSuccess: sync });
  return { create, update, remove };
}
