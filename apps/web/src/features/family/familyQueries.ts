import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMe } from '../../auth.js';
import { SYNC_INTERVAL_MS } from '../../queryClient.js';
import {
  createChild,
  createInvitation,
  createPasswordResetLink,
  deleteMember,
  listMembers,
  rotateJoinCode,
  updateMember,
  type MemberUpdate,
} from './familyApi.js';

export const familyKeys = {
  all: ['family'] as const,
  members: () => [...familyKeys.all, 'members'] as const,
};

export function useMembersQuery() {
  return useQuery({
    queryKey: familyKeys.members(),
    queryFn: listMembers,
    refetchInterval: SYNC_INTERVAL_MS,
  });
}

function useSyncAfterMemberChange() {
  const queryClient = useQueryClient();
  const { refresh } = useMe();

  return async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: familyKeys.members() }), refresh()]);
  };
}

export function useCreateChild() {
  const sync = useSyncAfterMemberChange();
  return useMutation({ mutationFn: createChild, onSuccess: sync });
}

export function useUpdateMember() {
  const sync = useSyncAfterMemberChange();
  return useMutation({
    mutationFn: ({ id, update }: { id: string; update: MemberUpdate }) => updateMember(id, update),
    onSuccess: sync,
  });
}

export function useDeleteMember() {
  const sync = useSyncAfterMemberChange();
  return useMutation({ mutationFn: deleteMember, onSuccess: sync });
}

export function useCreateInvitation() {
  return useMutation({ mutationFn: createInvitation });
}

export function useCreatePasswordResetLink() {
  return useMutation({ mutationFn: createPasswordResetLink });
}

export function useRotateJoinCode() {
  const { refresh } = useMe();
  return useMutation({ mutationFn: rotateJoinCode, onSuccess: () => refresh() });
}
