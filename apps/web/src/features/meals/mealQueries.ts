import { useQuery } from '@tanstack/react-query';
import { mealWeekResponseSchema } from '@rodzina/shared';
import { apiFetch } from '../../api.js';
import { useMe } from '../../sessionContext.js';
import { useOffline } from '../../connectivity.js';
import { SYNC_INTERVAL_MS } from '../../queryClient.js';
import { useMealState, saveMealWeek, mealRevision } from './mealOffline.js';
import { useOfflineSyncStatus } from '../../offline/status.js';

export function useMealWeek(week: string, enabled = true) {
  const { user, family, familyConfirmed } = useMe();
  const offline = useOffline();
  const state = useMealState();
  const account = `${family?.id}:${user?.id}`;
  const view = state.account === account ? state.view : undefined;
  const status = useOfflineSyncStatus(account, 'meals');
  const query = useQuery({
    queryKey: ['meals', family?.id, user?.id, week],
    enabled: enabled && !!user && !!family && familyConfirmed && !offline && !!view && !status.syncing,
    staleTime: 0,
    queryFn: async ({ signal }) => {
      const revision = mealRevision(week);
      if (revision.scope.account !== account) throw new DOMException('Session changed', 'AbortError');
      const data = mealWeekResponseSchema.parse(await apiFetch(`/api/meals?weekStart=${week}`, { signal }));
      signal.throwIfAborted();
      await saveMealWeek(data, revision);
      return data;
    },
    refetchInterval: SYNC_INTERVAL_MS,
  });
  const saved = view?.cache?.weeks[week];
  return {
    ...query,
    data: saved?.data,
    syncedAt: saved?.syncedAt,
    status,
    ready: !!view,
    isPending: !saved && query.isPending,
  };
}
