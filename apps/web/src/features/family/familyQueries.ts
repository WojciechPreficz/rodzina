import { useMutation, useQuery } from '@tanstack/react-query';
import { useMe } from '../../sessionContext.js';
import { familyMembersKey } from '../../offlineData.js';
import { isOffline, useOffline } from '../../connectivity.js';
import type { Member } from '@rodzina/shared';
import {
  createChild,
  createInvitation,
  createPasswordResetLink,
  rotateJoinCode,
  updateMember,
  type MemberUpdate,
} from './familyApi.js';

export const onlineActionHint = 'Dostępne po połączeniu z internetem';

export function useFamilyReadOnly() {
  const offline = useOffline();
  const { familyConfirmed } = useMe();
  return offline || !familyConfirmed;
}

export function useMembersQuery() {
  const { user, family } = useMe();
  return useQuery<Member[]>({
    queryKey: familyMembersKey(family?.id ?? '', user?.id ?? ''),
    // AuthProvider confirms the account before fetching and persisting members.
    enabled: false,
    gcTime: Infinity,
  });
}

function useSyncAfterMemberChange() {
  const { refresh } = useMe();
  return refresh;
}

function useOnlineMutation<T, R>(action: (input: T) => Promise<R>, onSuccess?: () => Promise<void>) {
  const readOnly = useFamilyReadOnly();
  return useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: (input: T) => {
      if (readOnly || isOffline()) throw new Error(onlineActionHint);
      return action(input);
    },
    ...(onSuccess ? { onSuccess } : {}),
  });
}

export function useCreateChild() {
  const sync = useSyncAfterMemberChange();
  return useOnlineMutation(createChild, sync);
}

export function useUpdateMember() {
  const sync = useSyncAfterMemberChange();
  return useOnlineMutation(({ id, update }: { id: string; update: MemberUpdate }) => updateMember(id, update), sync);
}

export function useCreateInvitation() {
  return useOnlineMutation(createInvitation);
}

export function useCreatePasswordResetLink() {
  return useOnlineMutation(createPasswordResetLink);
}

export function useRotateJoinCode() {
  const { refresh } = useMe();
  return useOnlineMutation(rotateJoinCode, refresh);
}
