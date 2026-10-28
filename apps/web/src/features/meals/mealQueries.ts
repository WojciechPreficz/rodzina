import { useQuery } from '@tanstack/react-query';
import { mealWeekResponseSchema } from '@rodzina/shared';
import { apiFetch } from '../../api.js';
import { useMe } from '../../sessionContext.js';
import { useOffline } from '../../connectivity.js';
import { SYNC_INTERVAL_MS } from '../../queryClient.js';

export function useMealWeek(week: string) {
  const { user, family, familyConfirmed } = useMe();
  const offline = useOffline();
  return useQuery({
    queryKey: ['meals', family?.id, user?.id, week],
    enabled: !!user && !!family && familyConfirmed && !offline,
    staleTime: 0,
    queryFn: async ({ signal }) =>
      mealWeekResponseSchema.parse(await apiFetch(`/api/meals?weekStart=${week}`, { signal })),
    refetchInterval: SYNC_INTERVAL_MS,
  });
}
