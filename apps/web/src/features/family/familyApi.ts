import { apiFetch } from '../../api.js';
import type { AuthRole, AuthUser } from '../../auth.js';

export type Member = AuthUser;

export type MemberUpdate = {
  displayName?: string;
  color?: string;
  role?: AuthRole;
  pin?: string;
};

export const MEMBER_COLORS = [
  '#1C7ED6',
  '#2F9E44',
  '#E8590C',
  '#AE3EC9',
  '#F08C00',
  '#C2255C',
  '#0C8599',
  '#7BC6B9',
] as const;

export async function listMembers(): Promise<Member[]> {
  const response = await apiFetch<{ members: Member[] }>('/api/members');
  return response.members;
}

export async function createChild(input: { displayName: string; pin: string; color: string }): Promise<Member> {
  const response = await apiFetch<{ member: Member }>('/api/members/child', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return response.member;
}

export async function updateMember(id: string, update: MemberUpdate): Promise<Member> {
  const response = await apiFetch<{ member: Member }>(`/api/members/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(update),
  });
  return response.member;
}

export async function deleteMember(id: string): Promise<void> {
  await apiFetch<{ deleted: boolean }>(`/api/members/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function createInvitation(role: 'admin' | 'member'): Promise<string> {
  const response = await apiFetch<{ link: string }>('/api/invitations', {
    method: 'POST',
    body: JSON.stringify({ role }),
  });
  return response.link;
}

export async function createPasswordResetLink(id: string): Promise<string> {
  const response = await apiFetch<{ link: string }>(`/api/members/${encodeURIComponent(id)}/password-reset-link`, {
    method: 'POST',
  });
  return response.link;
}

export async function rotateJoinCode(): Promise<string> {
  const response = await apiFetch<{ joinCode: string }>('/api/family/join-code/rotate', { method: 'POST' });
  return response.joinCode;
}
