import { describe, expect, it } from 'vitest';
import {
  roleSchema,
  publicUserSchema,
  familySchema,
  authMeResponseSchema,
  loginResponseSchema,
  loginChildResponseSchema,
  registerFamilyResponseSchema,
  acceptInvitationResponseSchema,
  membersResponseSchema,
  memberResponseSchema,
  familyMembersResponseSchema,
  createInvitationResponseSchema,
  invitationResponseSchema,
  familyResponseSchema,
  rotateJoinCodeResponseSchema,
  passwordResetLinkResponseSchema,
  authOkResponseSchema,
  deleteMemberResponseSchema,
} from './auth.js';

const user = {
  id: 'user',
  familyId: 'family',
  displayName: 'Anna',
  email: 'anna@example.com',
  role: 'admin',
  color: '#5C7CFA',
  createdAt: 1000,
  updatedAt: 2000,
};
const family = { id: 'family', name: 'Rodzina', timezone: 'Europe/Warsaw', joinCode: 'ABC234' };
const session = { ok: true, user, family };
const child = { id: 'child', displayName: 'Zosia', color: '#7BC6B9' };
const invitation = { id: 'invitation', role: 'member', expiresAt: 3000 };
const cases = [
  ['public user', publicUserSchema, user],
  ['family', familySchema, family],
  ['me', authMeResponseSchema, session],
  ['login', loginResponseSchema, session],
  ['child login', loginChildResponseSchema, session],
  ['registration', registerFamilyResponseSchema, session],
  ['accept invitation', acceptInvitationResponseSchema, session],
  ['members', membersResponseSchema, { ok: true, members: [user] }],
  ['member', memberResponseSchema, { ok: true, member: user }],
  ['child profiles', familyMembersResponseSchema, { ok: true, members: [child], children: [child] }],
  [
    'create invitation',
    createInvitationResponseSchema,
    { ok: true, invitation, token: 'token', link: '/zaproszenie/token' },
  ],
  [
    'invitation preview',
    invitationResponseSchema,
    { ok: true, family: { id: family.id, name: family.name }, invitation },
  ],
  ['update family', familyResponseSchema, { ok: true, family }],
  ['rotate code', rotateJoinCodeResponseSchema, { ok: true, joinCode: 'XYZ234' }],
  [
    'password reset link',
    passwordResetLinkResponseSchema,
    { ok: true, token: 'token', link: '/reset-hasla/token', expiresAt: 3000 },
  ],
  ['ok', authOkResponseSchema, { ok: true }],
  ['delete member', deleteMemberResponseSchema, { ok: true, deleted: true, resetOwnSession: false }],
] as const;

describe('auth response contracts', () => {
  it.each(cases)('preserves the complete %s response', (_name, schema, value) => {
    expect(schema.parse(value)).toEqual(value);
  });

  it.each(cases)('requires every field of %s', (_name, schema, value) => {
    for (const key of Object.keys(value)) {
      const incomplete: Record<string, unknown> = { ...value };
      delete incomplete[key];
      expect(schema.safeParse(incomplete).success, key).toBe(false);
    }
  });

  it.each(['admin', 'member', 'child'])('accepts role %s', (role) => {
    expect(roleSchema.parse(role)).toBe(role);
    expect(publicUserSchema.safeParse({ ...user, role }).success).toBe(true);
  });

  it('rejects invalid and missing roles, including nested users and invitations', () => {
    expect(roleSchema.safeParse('owner').success).toBe(false);
    expect(roleSchema.safeParse(undefined).success).toBe(false);
    expect(publicUserSchema.safeParse({ ...user, role: 'owner' }).success).toBe(false);
    expect(authMeResponseSchema.safeParse({ ...session, user: { ...user, role: 'owner' } }).success).toBe(false);
    expect(
      invitationResponseSchema.safeParse({ ok: true, family, invitation: { ...invitation, role: 'child' } }).success,
    ).toBe(false);
  });

  it('accepts a child with null email and rejects a missing email', () => {
    expect(publicUserSchema.parse({ ...user, role: 'child', email: null }).email).toBeNull();
    expect(publicUserSchema.safeParse({ ...user, email: undefined }).success).toBe(false);
  });

  it('limits public child profiles and invitation previews to their existing fields', () => {
    expect(familyMembersResponseSchema.parse({ ok: true, members: [user], children: [user] }).members).toEqual([
      { id: user.id, displayName: user.displayName, color: user.color },
    ]);
    expect(invitationResponseSchema.parse({ ok: true, family, invitation }).family).toEqual({
      id: family.id,
      name: family.name,
    });
  });
});
