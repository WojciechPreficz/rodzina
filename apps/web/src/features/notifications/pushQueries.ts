import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMe } from '../../auth.js';
import { SYNC_INTERVAL_MS } from '../../queryClient.js';
import { enablePush, readPushStatus, sendTestPush } from './pushClient.js';
import { isAndroid } from '../../platform.js';

export function usePushStatus() {
  const { user } = useMe();
  return useQuery({
    queryKey: ['push', user?.id],
    queryFn: readPushStatus,
    enabled: Boolean(user) && !isAndroid(),
    refetchInterval: SYNC_INTERVAL_MS,
    refetchOnWindowFocus: 'always',
  });
}

export function usePushActions() {
  const client = useQueryClient();
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['push'] });
  };
  const enable = useMutation({ mutationFn: enablePush, onSettled: refresh });
  const test = useMutation({ mutationFn: sendTestPush, onSettled: refresh });
  return { enable, test };
}
