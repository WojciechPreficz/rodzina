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
import { onlineActionHint, useFamilyReadOnly } from './familyQueries.js';
import { useOffline } from '../../connectivity.js';
import { useOfflineStorageIssue } from '../../offlineData.js';

function InviteCard() {
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const invitation = useCreateInvitation();
  const readOnly = useFamilyReadOnly();

  return (
    <Card withBorder radius="lg" p="lg">
      <Stack gap="sm">
        <Text fw={600}>{labels.inviteTitle}</Text>
        <Text size="sm" c="dimmed">
          {labels.inviteHint}
        </Text>
        <Radio.Group
          readOnly={readOnly}
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
          <Button
            disabled={readOnly}
            title={readOnly ? onlineActionHint : undefined}
            onClick={() => invitation.mutate(role)}
            loading={invitation.isPending}
          >
            {labels.createInvitation}
          </Button>
        </Group>
        {readOnly && (
          <Text size="sm" c="dimmed">
            {onlineActionHint}
          </Text>
        )}
        {invitation.error ? <Alert color="red">{errorMessage(invitation.error, labels.saveError)}</Alert> : null}
        {invitation.data && !readOnly ? (
          <LinkActions link={invitation.data} shareTitle={labels.invitationShareTitle} />
        ) : null}
      </Stack>
    </Card>
  );
}

function JoinCodeCard({ joinCode, canRotate }: { joinCode: string; canRotate: boolean }) {
  const rotation = useRotateJoinCode();
  const readOnly = useFamilyReadOnly();
  const offline = useOffline();

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
          {joinCode || 'Brak zapisanego kodu rodziny'}
        </Text>
        {offline && joinCode && (
          <Text size="sm" c="dimmed">
            Ostatnio zapisany kod rodziny. Mógł się zmienić na innym urządzeniu.
          </Text>
        )}
        {canRotate ? (
          <Group>
            <Button
              disabled={readOnly}
              title={readOnly ? onlineActionHint : undefined}
              variant="light"
              onClick={onRotate}
              loading={rotation.isPending}
            >
              {labels.rotateJoinCode}
            </Button>
          </Group>
        ) : null}
        {canRotate && readOnly && (
          <Text size="sm" c="dimmed">
            {onlineActionHint}
          </Text>
        )}
        {rotation.error ? <Alert color="red">{errorMessage(rotation.error, labels.saveError)}</Alert> : null}
      </Stack>
    </Card>
  );
}

export function FamilyPage() {
  const { user, family, familySyncedAt, familySyncError } = useMe();
  const offline = useOffline();
  const readOnly = useFamilyReadOnly();
  const storageIssue = useOfflineStorageIssue();
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

      {offline && (
        <Alert color="yellow" role="status">
          Jesteś offline — pokazujemy ostatnio zapisane dane. Zmiany wymagają połączenia z internetem.
          {familySyncedAt && (
            <Text size="sm">Ostatnie udane pobranie: {new Date(familySyncedAt).toLocaleString('pl-PL')}</Text>
          )}
        </Alert>
      )}
      {storageIssue && <Alert color="red">{storageIssue}</Alert>}
      {!offline && (familySyncError || membersQuery.error) ? (
        <Alert color="red">{familySyncError || errorMessage(membersQuery.error, labels.membersLoadError)}</Alert>
      ) : null}

      <Card withBorder radius="lg" p="lg">
        <Stack gap="sm">
          <Group justify="space-between">
            <Text fw={600}>{labels.members}</Text>
            {isAdmin ? (
              <Button
                disabled={readOnly}
                title={readOnly ? onlineActionHint : undefined}
                size="xs"
                onClick={() => setIsAddChildOpen(true)}
              >
                {labels.addChild}
              </Button>
            ) : null}
          </Group>

          {readOnly && (
            <Text size="sm" c="dimmed">
              {onlineActionHint}
            </Text>
          )}
          {offline && !membersQuery.data ? (
            <Text>Brak danych rodziny zapisanych na tym urządzeniu. Połącz się z internetem, aby je pobrać.</Text>
          ) : null}
          {membersQuery.isPending && !offline && !familySyncError ? <Loader size="sm" /> : null}

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
                      disabled={readOnly}
                      title={readOnly ? onlineActionHint : undefined}
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
