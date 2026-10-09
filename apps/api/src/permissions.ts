export const FAMILY_ROLES = ['admin', 'member', 'child'] as const;

export type FamilyRole = (typeof FAMILY_ROLES)[number];

export function isAdmin(role: FamilyRole): boolean {
  return role === 'admin';
}

export function isMember(role: FamilyRole): boolean {
  return role === 'member';
}

export function isChild(role: FamilyRole): boolean {
  return role === 'child';
}

export function canManageFamilyMembers(role: FamilyRole): boolean {
  return role === 'admin';
}

export function canEditMemberProfile(actorRole: FamilyRole, actorId: string, targetId: string): boolean {
  if (actorRole === 'admin') {
    return true;
  }

  return actorId === targetId;
}

export function canUpdateMemberRole(actorRole: FamilyRole): boolean {
  return actorRole === 'admin';
}

export function canSetChildPin(actorRole: FamilyRole): boolean {
  return actorRole === 'admin';
}
