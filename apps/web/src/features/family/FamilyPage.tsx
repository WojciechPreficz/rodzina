import { PageHeader } from '../../components/PageHeader.js';
import { Alert, Button, Card, ColorSwatch, Group, Loader, Radio, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { useMe } from '../../sessionContext.js';
import { labels } from '../../i18n/pl.js';
import { LinkActions } from './LinkActions.js';
import { AddChildModal, EditMemberModal } from './MemberDialogs.js';
import type { Member } from '@rodzina/shared';

import { useCreateInvitation, useMembersQuery, useRotateJoinCode } from './familyQueries.js';
import { canEditProfile, errorMessage, isFamilyAdmin } from './familyRules.js';
import { onlineActionHint, useFamilyReadOnly } from './familyQueries.js';
import { useOffline } from '../../connectivity.js';
import { OfflineNotice } from '../../offline/OfflineNotice.js';

function InviteCard() {
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const invitation = useCreateInvitation();
  const readOnly = useFamilyReadOnly();

  return (
    <Card className="settings-card" withBorder p="lg">
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
    <Card className="settings-card" withBorder p="lg">
      <Stack gap="sm">
        <Text fw={600}>{labels.joinCode}</Text>
        <Text size="sm" c="dimmed">
          {labels.joinCodeHint}
        </Text>
        <Text className="family-join-code" ff="monospace" size="xl" fw={700}>
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
  const membersQuery = useMembersQuery();
  const [editedMember, setEditedMember] = useState<Member | null>(null);
  const [isAddChildOpen, setIsAddChildOpen] = useState(false);

  if (!user || !family) {
    return null;
  }

  const isAdmin = isFamilyAdmin(user);

  return (
    <Stack className="settings-page family-page" gap="lg">
      <PageHeader title={labels.family} description={family.name} />

      <OfflineNotice offline={offline} syncedAt={familySyncedAt}>
        Jesteś offline — pokazujemy ostatnio zapisane dane. Zmiany wymagają połączenia z internetem.
      </OfflineNotice>
      {!offline && (familySyncError || membersQuery.error) ? (
        <Alert color="red">{familySyncError || errorMessage(membersQuery.error, labels.membersLoadError)}</Alert>
      ) : null}

      <Card className="settings-card" withBorder p="lg">
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
            <Stack gap={0} className="family-members">
              {membersQuery.data.map((member) => (
                <Group className="family-member" key={member.id} justify="space-between" wrap="nowrap">
                  <Group className="family-member-identity" gap="sm" wrap="nowrap">
                    <ColorSwatch color={member.color} size={24} />
                    <div className="family-member-name">
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
