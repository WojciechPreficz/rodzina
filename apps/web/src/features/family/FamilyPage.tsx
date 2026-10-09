import { Alert, Button, Card, ColorSwatch, Group, Loader, Radio, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { Link } from 'react-router';
import { useMe } from '../../auth.js';
import { labels } from '../../i18n/pl.js';
import { LinkActions } from './LinkActions.js';
import { AddChildModal, EditMemberModal } from './MemberDialogs.js';
import type { Member } from './familyApi.js';
import { useCreateInvitation, useMembersQuery, useRotateJoinCode } from './familyQueries.js';
import { canEditProfile, errorMessage, isFamilyAdmin } from './familyRules.js';

function InviteCard() {
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const invitation = useCreateInvitation();

  return (
    <Card withBorder radius="lg" p="lg">
      <Stack gap="sm">
        <Text fw={600}>{labels.inviteTitle}</Text>
        <Text size="sm" c="dimmed">
          {labels.inviteHint}
        </Text>
        <Radio.Group
          label={labels.role}
          value={role}
          onChange={(value) => {
            setRole(value === 'admin' ? 'admin' : 'member');
            invitation.reset();
          }}
        >
          <Group gap="md" mt={4}>
            <Radio value="member" label={labels.roles.member} />
            <Radio value="admin" label={labels.roles.admin} />
          </Group>
        </Radio.Group>
        <Group>
          <Button onClick={() => invitation.mutate(role)} loading={invitation.isPending}>
            {labels.createInvitation}
          </Button>
        </Group>
        {invitation.error ? <Alert color="red">{errorMessage(invitation.error, labels.saveError)}</Alert> : null}
        {invitation.data ? <LinkActions link={invitation.data} shareTitle={labels.invitationShareTitle} /> : null}
      </Stack>
    </Card>
  );
}

function JoinCodeCard({ joinCode, canRotate }: { joinCode: string; canRotate: boolean }) {
  const rotation = useRotateJoinCode();

  const onRotate = () => {
    if (window.confirm(labels.rotateJoinCodeConfirm)) {
      rotation.mutate();
    }
  };

  return (
    <Card withBorder radius="lg" p="lg">
      <Stack gap="sm">
        <Text fw={600}>{labels.joinCode}</Text>
        <Text size="sm" c="dimmed">
          {labels.joinCodeHint}
        </Text>
        <Text ff="monospace" size="xl" fw={700} style={{ letterSpacing: '0.2em' }}>
          {joinCode}
        </Text>
        {canRotate ? (
          <Group>
            <Button variant="light" onClick={onRotate} loading={rotation.isPending}>
              {labels.rotateJoinCode}
            </Button>
          </Group>
        ) : null}
        {rotation.error ? <Alert color="red">{errorMessage(rotation.error, labels.saveError)}</Alert> : null}
      </Stack>
    </Card>
  );
}

export function FamilyPage() {
  const { user, family } = useMe();
  const membersQuery = useMembersQuery();
  const [editedMember, setEditedMember] = useState<Member | null>(null);
  const [isAddChildOpen, setIsAddChildOpen] = useState(false);

  if (!user || !family) {
    return null;
  }

  const isAdmin = isFamilyAdmin(user);

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Text component="h2" size="xl" fw={700}>
          {labels.family}
        </Text>
        <Button component={Link} to="/wiecej" variant="subtle">
          {labels.back}
        </Button>
      </Group>

      {membersQuery.error ? (
        <Alert color="red">{errorMessage(membersQuery.error, labels.membersLoadError)}</Alert>
      ) : null}

      <Card withBorder radius="lg" p="lg">
        <Stack gap="sm">
          <Group justify="space-between">
            <Text fw={600}>{labels.members}</Text>
            {isAdmin ? (
              <Button size="xs" onClick={() => setIsAddChildOpen(true)}>
                {labels.addChild}
              </Button>
            ) : null}
          </Group>

          {membersQuery.isPending ? <Loader size="sm" /> : null}

          {membersQuery.data ? (
            <Stack gap="xs">
              {membersQuery.data.map((member) => (
                <Group key={member.id} justify="space-between" wrap="nowrap">
                  <Group gap="sm" wrap="nowrap">
                    <ColorSwatch color={member.color} size={24} />
                    <div>
                      <Text fw={500}>
                        {member.displayName}
                        {member.id === user.id ? ` ${labels.you}` : ''}
                      </Text>
                      <Text size="sm" c="dimmed">
                        {labels.roles[member.role]}
                      </Text>
                    </div>
                  </Group>
                  {canEditProfile(user, member) ? (
                    <Button
                      size="xs"
                      variant="light"
                      aria-label={`${labels.edit}: ${member.displayName}`}
                      onClick={() => setEditedMember(member)}
                    >
                      {labels.edit}
                    </Button>
                  ) : null}
                </Group>
              ))}
            </Stack>
          ) : null}
        </Stack>
      </Card>

      {isAdmin ? <InviteCard /> : null}

      <JoinCodeCard joinCode={family.joinCode} canRotate={isAdmin} />

      {isAddChildOpen ? <AddChildModal onClose={() => setIsAddChildOpen(false)} /> : null}

      {editedMember ? (
        <EditMemberModal
          key={editedMember.id}
          member={editedMember}
          actor={user}
          onClose={() => setEditedMember(null)}
        />
      ) : null}
    </Stack>
  );
}
