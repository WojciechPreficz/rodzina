import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EventPatch, EventScope } from '@rodzina/shared';
import { useMe } from '../../sessionContext.js';
import { ApiRequestError } from '../../api.js';
import { isOffline, useOffline } from '../../connectivity.js';
import { SYNC_INTERVAL_MS } from '../../queryClient.js';
import { refreshLocalSchedule } from '../notifications/scheduleSync.js';
import { createEvent, deleteEvent, updateEvent, type CalendarRange } from './calendarApi.js';
import { calendarStore, readCalendarRange, useCalendarSnapshot } from './calendarOffline.js';
import { fetchSavedDistant, fetchSavedEvent, fetchSavedRange } from './calendarSync.js';

export const calendarOnlineHint = 'Dostępne po połączeniu z internetem';
export function useCalendarReadOnly() {
  const offline = useOffline();
  const { familyConfirmed } = useMe();
  return offline || !familyConfirmed;
}
export function useCalendarOnlineMutation<T, R>(action: (input: T) => Promise<R>, onSuccess?: () => Promise<void>) {
  const readOnly = useCalendarReadOnly();
  return useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: (input: T) => {
      if (readOnly || isOffline()) throw new Error(calendarOnlineHint);
      return action(input);
    },
    ...(onSuccess ? { onSuccess } : {}),
  });
}
function useCalendarAccount() {
  const { family, user, familyConfirmed } = useMe();
  const offline = useOffline();
  const snapshot = useCalendarSnapshot();
  const account = `${family?.id}:${user?.id}`;
  return {
    family,
    user,
    snapshot,
    enabled: !!family && !!user && familyConfirmed && !offline,
    matches: snapshot.account === account,
  };
}
export function useDistantEvents() {
  const { family, user, snapshot, enabled, matches } = useCalendarAccount();
  const query = useQuery({
    queryKey: ['calendar', family?.id, user?.id, 'distant'],
    queryFn: () => {
      if (!enabled || isOffline()) throw new Error(calendarOnlineHint);
      return fetchSavedDistant();
    },
    enabled,
    refetchInterval: SYNC_INTERVAL_MS,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const saved = matches ? snapshot.distant : undefined;
  return {
    ...query,
    data: saved?.ids.flatMap((id) => snapshot.details[id]?.event ?? []) ?? query.data,
    syncedAt: saved?.syncedAt,
  };
}
export function useOccurrences(range: CalendarRange) {
  const { family, user, snapshot, enabled, matches } = useCalendarAccount();
  const query = useQuery({
    queryKey: ['calendar', family?.id, user?.id, 'occurrences', range],
    queryFn: () => {
      if (!enabled || isOffline()) throw new Error(calendarOnlineHint);
      return fetchSavedRange(range);
    },
    enabled,
    refetchInterval: SYNC_INTERVAL_MS,
    refetchOnWindowFocus: false,
    retry: false,
  });
  useEffect(() => {
    calendarStore.touch({ from: range.from, to: range.to });
  }, [range.from, range.to]);
  const saved = readCalendarRange(
    matches ? snapshot : { ...snapshot, ranges: [] },
    range,
    family?.timezone ?? 'Europe/Warsaw',
  );
  return { ...query, ...saved };
}
export function useEvent(id: string) {
  const { family, user, snapshot, enabled, matches } = useCalendarAccount();
  const query = useQuery({
    queryKey: ['calendar', family?.id, user?.id, 'event', id],
    queryFn: () => {
      if (!enabled || isOffline()) throw new Error(calendarOnlineHint);
      return fetchSavedEvent(id);
    },
    enabled,
    refetchInterval: SYNC_INTERVAL_MS,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const revoked = query.error instanceof ApiRequestError && [401, 403, 404].includes(query.error.status);
  const saved = matches ? snapshot.details[id] : undefined;
  return { ...query, data: revoked ? undefined : saved?.event, syncedAt: saved?.syncedAt };
}
export function useCalendarMutations() {
  const client = useQueryClient();
  const sync = async () => {
    await refreshLocalSchedule(client);
    calendarStore.markStale();
    await client.invalidateQueries({ queryKey: ['calendar'] });
  };
  const create = useCalendarOnlineMutation(createEvent, sync);
  const update = useCalendarOnlineMutation(
    ({ id, data, scope }: { id: string; data: EventPatch; scope?: EventScope }) => updateEvent(id, data, scope),
    sync,
  );
  const remove = useCalendarOnlineMutation(deleteEvent, sync);
  return { create, update, remove };
}
