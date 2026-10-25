import { useState, type FormEvent } from 'react';
import { Alert, Button, Group, NativeSelect, Stack, Textarea, TextInput } from '@mantine/core';
import {
  createContactSchema,
  createContactGroupSchema,
  type Contact,
  type ContactGroup,
  type CreateContact,
} from '@rodzina/shared';
import { useFormNavigation } from '../../useFormNavigation.js';
import { allowNavigation } from '../../nativeNavigation.js';

export function ContactForm({
  contact,
  groups,
  groupId,
  groupOnly = false,
  initialName = '',
  disabled,
  pending,
  onSave,
  onCancel,
}: {
  contact?: Contact | undefined;
  groups: ContactGroup[];
  groupId: string;
  groupOnly?: boolean;
  initialName?: string;
  disabled: boolean;
  pending: boolean;
  onSave: (data: CreateContact) => Promise<void>;
  onCancel: () => void;
}) {
  const navigation = useFormNavigation();
  const [name, setName] = useState(contact?.name ?? initialName);
  const [selectedGroup, setGroup] = useState(contact?.groupId ?? groupId);
  const [relationship, setRelationship] = useState(contact?.relationship ?? '');
  const [phone, setPhone] = useState(contact?.phone ?? '');
  const [address, setAddress] = useState(contact?.address ?? '');
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || pending) return;
    const result = groupOnly
      ? createContactGroupSchema.safeParse({ name })
      : createContactSchema.safeParse({ name, groupId: selectedGroup, relationship, phone, address });
    if (!result.success) {
      setError('Sprawdź nazwę i długość wpisanych danych.');
      return;
    }
    setError('');
    try {
      await onSave(result.data);
      navigation.saved();
      onCancel();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nie udało się zapisać zmian.');
    }
  }
  return (
    <form data-navigation-guard="true" onChange={navigation.changed} onSubmit={(event) => void submit(event)}>
      <Stack>
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        {disabled && <Alert color="yellow">Połącz się z internetem, aby zapisać zmiany.</Alert>}
        <fieldset disabled={disabled || pending} className="contact-fieldset">
          <Stack>
            <TextInput
              label={groupOnly ? 'Nazwa grupy' : 'Imię i nazwisko lub nazwa'}
              required
              maxLength={groupOnly ? 60 : 120}
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              data-autofocus
            />
            {!groupOnly && (
              <>
                <NativeSelect
                  label="Grupa"
                  value={selectedGroup}
                  data={groups.map((group) => ({ value: group.id, label: group.name }))}
                  onChange={(event) => setGroup(event.currentTarget.value)}
                />
                <TextInput
                  label="Opis relacji"
                  placeholder="np. Mama"
                  maxLength={120}
                  value={relationship}
                  onChange={(event) => setRelationship(event.currentTarget.value)}
                />
                <TextInput
                  label="Telefon"
                  type="tel"
                  maxLength={50}
                  value={phone}
                  onChange={(event) => setPhone(event.currentTarget.value)}
                />
                <Textarea
                  label="Adres"
                  minRows={3}
                  maxLength={1000}
                  value={address}
                  onChange={(event) => setAddress(event.currentTarget.value)}
                />
              </>
            )}
          </Stack>
        </fieldset>
        <Group justify="flex-end">
          <Button
            variant="default"
            disabled={pending}
            onClick={() => {
              if (allowNavigation()) onCancel();
            }}
          >
            Anuluj
          </Button>
          <Button type="submit" disabled={disabled} loading={pending}>
            Zapisz
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
