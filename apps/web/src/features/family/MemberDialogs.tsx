import {
  Alert,
  Button,
  CheckIcon,
  ColorSwatch,
  Group,
  Modal,
  PasswordInput,
  Radio,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useState, type FormEvent } from 'react';
import type { AuthUser } from '../../auth.js';
import { labels } from '../../i18n/pl.js';
import { LinkActions } from './LinkActions.js';
import { MEMBER_COLORS, type Member, type MemberUpdate } from './familyApi.js';
import { useCreateChild, useCreatePasswordResetLink, useDeleteMember, useUpdateMember } from './familyQueries.js';
import { errorMessage, validateDisplayName, validatePin } from './familyRules.js';

const swatchStyle = { cursor: 'pointer' };
const selectedSwatchStyle = { cursor: 'pointer', outline: '2px solid var(--mantine-color-dark-6)', outlineOffset: 2 };

function ColorField({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>
        {labels.color}
      </Text>
      <Group gap="xs" role="radiogroup" aria-label={labels.color}>
        {MEMBER_COLORS.map((color) => {
          const isSelected = value.toLowerCase() === color.toLowerCase();
          return (
            <ColorSwatch
              key={color}
              component="button"
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={color}
              color={color}
              style={isSelected ? selectedSwatchStyle : swatchStyle}
              onClick={() => onChange(color)}
            >
              {isSelected ? <CheckIcon size={12} color="white" /> : null}
            </ColorSwatch>
          );
        })}
      </Group>
    </Stack>
  );
}

function PinField({
  label,
  description,
  value,
  error,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  error: string;
  onChange: (value: string) => void;
}) {
  return (
    <PasswordInput
      label={label}
      description={description}
      inputMode="numeric"
      autoComplete="new-password"
      maxLength={6}
      value={value}
      error={error}
      onChange={(event) => onChange(event.currentTarget.value.replace(/\D/g, ''))}
    />
  );
}

export function AddChildModal({ onClose }: { onClose: () => void }) {
  const [displayName, setDisplayName] = useState('');
  const [pin, setPin] = useState('');
  const [color, setColor] = useState<string>(MEMBER_COLORS[0]);
  const [fieldErrors, setFieldErrors] = useState({ displayName: '', pin: '' });
  const createMutation = useCreateChild();

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = { displayName: validateDisplayName(displayName), pin: validatePin(pin) };
    setFieldErrors(nextErrors);
    if (nextErrors.displayName || nextErrors.pin) {
      return;
    }

    createMutation.mutate({ displayName: displayName.trim(), pin, color }, { onSuccess: onClose });
  };

  return (
    <Modal opened onClose={onClose} title={labels.addChild} centered>
      <form onSubmit={onSubmit} noValidate>
        <Stack gap="sm">
          <TextInput
            label={labels.displayName}
            value={displayName}
            error={fieldErrors.displayName}
            onChange={(event) => setDisplayName(event.currentTarget.value)}
            required
          />
          <PinField
            label={labels.pin}
            description={labels.pinHint}
            value={pin}
            error={fieldErrors.pin}
            onChange={setPin}
          />
          <ColorField value={color} onChange={setColor} />
          {createMutation.error ? (
            <Alert color="red">{errorMessage(createMutation.error, labels.saveError)}</Alert>
          ) : null}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {labels.cancel}
            </Button>
            <Button type="submit" loading={createMutation.isPending}>
              {labels.addChild}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

type EditMemberModalProps = {
  member: Member;
  actor: AuthUser;
  onClose: () => void;
};

export function EditMemberModal({ member, actor, onClose }: EditMemberModalProps) {
  const isAdmin = actor.role === 'admin';
  const isSelf = actor.id === member.id;
  const isChildMember = member.role === 'child';

  const [displayName, setDisplayName] = useState(member.displayName);
  const [color, setColor] = useState(member.color);
  const [role, setRole] = useState(member.role);
  const [pin, setPin] = useState('');
  const [fieldErrors, setFieldErrors] = useState({ displayName: '', pin: '' });

  const updateMutation = useUpdateMember();
  const deleteMutation = useDeleteMember();
  const resetLinkMutation = useCreatePasswordResetLink();

  const isSubmitting = updateMutation.isPending || deleteMutation.isPending;
  const mutationError = updateMutation.error ?? deleteMutation.error ?? resetLinkMutation.error;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = { displayName: validateDisplayName(displayName), pin: pin ? validatePin(pin) : '' };
    setFieldErrors(nextErrors);
    if (nextErrors.displayName || nextErrors.pin) {
      return;
    }

    const update: MemberUpdate = {};
    if (displayName.trim() !== member.displayName) {
      update.displayName = displayName.trim();
    }
    if (color !== member.color) {
      update.color = color;
    }
    if (isAdmin && role !== member.role) {
      update.role = role;
    }
    if (isAdmin && isChildMember && pin) {
      update.pin = pin;
    }

    if (Object.keys(update).length === 0) {
      onClose();
      return;
    }

    updateMutation.mutate({ id: member.id, update }, { onSuccess: onClose });
  };

  const onDelete = () => {
    if (window.confirm(`${labels.deleteMemberConfirm} ${member.displayName}?`)) {
      deleteMutation.mutate(member.id, { onSuccess: onClose });
    }
  };

  return (
    <Modal opened onClose={onClose} title={`${labels.edit}: ${member.displayName}`} centered>
      <form onSubmit={onSubmit} noValidate>
        <Stack gap="sm">
          <TextInput
            label={labels.displayName}
            value={displayName}
            error={fieldErrors.displayName}
            onChange={(event) => setDisplayName(event.currentTarget.value)}
            required
          />
          <ColorField value={color} onChange={setColor} />

          {isAdmin && !isChildMember ? (
            <Radio.Group
              label={labels.role}
              value={role}
              onChange={(value) => setRole(value === 'admin' ? 'admin' : 'member')}
            >
              <Group gap="md" mt={4}>
                <Radio value="member" label={labels.roles.member} />
                <Radio value="admin" label={labels.roles.admin} />
              </Group>
            </Radio.Group>
          ) : null}

          {isAdmin && isChildMember ? (
            <PinField
              label={labels.newPin}
              description={labels.newPinHint}
              value={pin}
              error={fieldErrors.pin}
              onChange={setPin}
            />
          ) : null}

          {mutationError ? <Alert color="red">{errorMessage(mutationError, labels.saveError)}</Alert> : null}

          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {labels.cancel}
            </Button>
            <Button type="submit" loading={updateMutation.isPending} disabled={deleteMutation.isPending}>
              {labels.save}
            </Button>
          </Group>

          {isAdmin && member.email !== null ? (
            <Stack gap="xs">
              <Button
                variant="light"
                onClick={() => resetLinkMutation.mutate(member.id)}
                loading={resetLinkMutation.isPending}
              >
                {labels.passwordResetLink}
              </Button>
              {resetLinkMutation.data ? (
                <LinkActions link={resetLinkMutation.data} shareTitle={labels.passwordResetShareTitle} />
              ) : null}
            </Stack>
          ) : null}

          {isAdmin && !isSelf ? (
            <Button
              color="red"
              variant="light"
              onClick={onDelete}
              loading={deleteMutation.isPending}
              disabled={isSubmitting}
            >
              {labels.deleteMember}
            </Button>
          ) : null}
        </Stack>
      </form>
    </Modal>
  );
}
